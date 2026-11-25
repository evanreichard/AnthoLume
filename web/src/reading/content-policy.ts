import { ArchiveReader, blobSource, hashSource, sourceTask, type Source, type ZipIndex } from './source';
import type { BookManifest, DocumentInfo } from './book-manifest';
import { archiveReference } from './archive-path';
import { ChapterPolicy, passiveExternalLink } from './chapter-policy';
import { requireStableBody } from './body-contract';
import { rasterDimensions } from './media-budget';

const XHTML = 'http://www.w3.org/1999/xhtml',
  SVG = 'http://www.w3.org/2000/svg';
const svgTags = new Set(
  'svg g defs symbol use image title desc style path rect circle ellipse line polyline polygon text tspan linearGradient radialGradient stop clipPath'.split(
    ' ',
  ),
);
const svgAttributes = new Set(
  'xmlns xmlns:xlink xml:lang id class style version viewBox preserveAspectRatio width height x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin opacity clip-path clip-rule offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod href xlink:href font-family font-size text-anchor role aria-label'.split(
    ' ',
  ),
);
const activeTags = new Set(
  'script base iframe frame frameset object embed area form input button textarea select foreignobject animate animatetransform animatemotion set'.split(
    ' ',
  ),
);
const paintAttributes = new Set('fill stroke clip-path mask filter marker-start marker-mid marker-end'.split(' '));
const mediaByExtension: Record<string, string> = {
  xhtml: 'application/xhtml+xml',
  html: 'application/xhtml+xml',
  css: 'text/css',
  ncx: 'application/x-dtbncx+xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
};
function text(data: Uint8Array) {
  return new TextDecoder('utf-8', { fatal: true }).decode(data);
}
function requireResource(value: string, entry: string, data: ReadonlyMap<string, unknown>) {
  const ref = archiveReference(value, entry);
  if (!data.has(ref.path)) throw new Error('Missing archive resource');
  return ref.path;
}

export function parseDocument(value: Uint8Array): Document {
  const source = text(value);
  if (/<!ENTITY|<!DOCTYPE[^>]*\[|<\?(?!xml\s)/i.test(source))
    throw new Error('Unsupported XML entity/DTD/processing instruction');
  const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid XML');
  const elements = doc.querySelectorAll('*');
  if (elements.length > 50000) throw new Error('Document node budget exceeded');
  for (const element of elements) {
    let depth = 0,
      ancestor = element.parentElement;
    while (ancestor) {
      if (++depth > 64) throw new Error('Document depth budget exceeded');
      ancestor = ancestor.parentElement;
    }
  }
  return doc;
}
export async function validateEPUB(
  input: Source | Blob | ArrayBuffer,
  signal?: AbortSignal,
  lazy = false,
  onStage?: (message: string) => void,
): Promise<ChapterPolicy> {
  let source: Source =
    input instanceof Blob ? blobSource(input) : input instanceof ArrayBuffer ? blobSource(new Blob([input])) : input;
  let integrity = null;
  if (!lazy) {
    onStage?.('Checking file integrity…');
    integrity = await hashSource(source, signal);
    source = { ...source, digests: integrity.digests };
  }
  onStage?.('Reading the ZIP directory…');
  const index = await sourceTask<ZipIndex>(source, lazy ? 'directory' : 'index', undefined, signal),
    reader = new ArchiveReader(source, index, signal);
  onStage?.('Checking the EPUB package…');
  if (!reader.byName.has('META-INF/container.xml') || text(await reader.bytes('mimetype')) !== 'application/epub+zip')
    throw new Error('Not an EPUB');
  const infos: Record<string, DocumentInfo> = Object.create(null);
  let infoBytes = 0;
  for (const entry of index.entries) {
    const name = entry.name;
    if (name.endsWith('/')) {
      if (entry.expanded) throw new Error('Nonempty directory');
      continue;
    }
    if (
      !lazy &&
      name !== 'mimetype' &&
      !/\.(xhtml|html|xml|opf|ncx|css|svg|png|jpe?g|gif|webp|woff2?|ttf|otf)$/i.test(name)
    )
      throw new Error('Unsupported archive resource type');
    if (lazy || !/\.(xhtml|html|xml|opf|ncx|svg)$/i.test(name)) continue;
    const doc = parseDocument(await reader.bytes(name));
    const info = documentInfo(doc, entry.expanded);
    infoBytes += new Blob([JSON.stringify(info)]).size;
    if (infoBytes > 8 * 1024 * 1024) throw new Error('Document identity metadata exceeds 8 MiB');
    infos[name] = info;
  }
  const container = parseDocument(await reader.bytes('META-INF/container.xml'));
  const opfPath = requireResource(
      container.querySelector('rootfile')?.getAttribute('full-path') || '',
      '',
      reader.byName,
    ),
    opf = parseDocument(await reader.bytes(opfPath));
  const docs = new Map([
    ['META-INF/container.xml', container],
    [opfPath, opf],
  ]);
  const manifest: BookManifest = {
    version: 2,
    ...(lazy ? { lazy: true } : {}),
    integrity,
    index,
    opf: opfPath,
    spine: [],
    navigation: [],
    roles: [],
    documents: infos,
    dependencies: [],
    staticDependencies: [],
    images: {},
    pixels: {},
    title: opf.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0]?.textContent || null,
    author: opf.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator')[0]?.textContent || null,
  };
  const policy = validateStructure(docs, reader, manifest);
  try {
    if (lazy) {
      validateDocument(opf, opfPath, policy);
      for (const path of manifest.navigation) await policy.document(path);
      return policy;
    }
    for (const entry of index.entries) {
      if (entry.name.endsWith('/')) {
        await reader.bytes(entry.name);
        continue;
      }
      signal?.throwIfAborted();
      const value = await reader.bytes(entry.name),
        media = policy.roles.get(entry.name);
      if (media) {
        const dimensions = validateBinary(media, value);
        if (dimensions) {
          manifest.images[entry.name] = dimensions;
          manifest.pixels[entry.name] = dimensions.width * dimensions.height;
        }
      }
      if (infos[entry.name]) {
        const doc = parseDocument(value);
        validateDocument(doc, entry.name, policy);
        if (doc.documentElement.namespaceURI === XHTML) requireStableBody(doc);
      }
      if (entry.name.endsWith('.css')) policy.css(text(value), entry.name);
    }
    policy.validateAssetGraph();
    manifest.dependencies = [...policy.dependencies].map(([name, targets]) => [name, [...targets]]);
    manifest.staticDependencies = [...policy.staticDependencies].map(([name, targets]) => [name, [...targets]]);
    if (new Blob([JSON.stringify(manifest)]).size > 16 * 1024 * 1024)
      throw new Error('Validated index metadata exceeds 16 MiB');
    return policy;
  } catch (error) {
    policy.dispose();
    throw error;
  }
}

export function documentInfo(doc: Document, bytes: number): DocumentInfo {
  const ids = [...doc.querySelectorAll('[id]')];
  return {
    root: doc.documentElement.localName,
    namespace: doc.documentElement.namespaceURI,
    ids: ids.map((e) => e.id),
    svgIds: ids.filter((e) => e.namespaceURI === SVG).map((e) => e.id),
    words: (doc.querySelector('body')?.textContent || '').trim().split(/\s+/).length,
    bytes,
    head: !!doc.querySelector('html > head'),
    body: !!doc.querySelector('html > body'),
  };
}

export function validateLoadedDocument(doc: Document, entry: string, policy: ChapterPolicy, info: DocumentInfo) {
  const media = policy.roles.get(entry);
  if (
    media === 'application/xhtml+xml' &&
    (info.root !== 'html' || info.namespace !== XHTML || !info.head || !info.body)
  )
    throw new Error('Invalid XHTML resource');
  if (media === 'image/svg+xml' && (info.root !== 'svg' || info.namespace !== SVG))
    throw new Error('Invalid packaged SVG');
  if (
    media === 'application/x-dtbncx+xml' &&
    (info.root !== 'ncx' || info.namespace !== 'http://www.daisy.org/z3986/2005/ncx/')
  )
    throw new Error('Invalid NCX resource');
  validateDocument(doc, entry, policy);
  if (info.namespace === XHTML) requireStableBody(doc);
}

function validateDocument(doc: Document, entry: string, policy: ChapterPolicy) {
  const content = doc.documentElement.namespaceURI === XHTML || doc.documentElement.namespaceURI === SVG;
  for (const element of doc.querySelectorAll('*')) {
    const tag = element.localName,
      lower = tag.toLowerCase(),
      svg = element.namespaceURI === SVG;
    if (activeTags.has(lower)) {
      if (policy.manifest.lazy && lower === 'script' && content) {
        element.remove();
        policy.recordUnavailableAsset();
        continue;
      }
      throw new Error(`Active content element: ${tag}`);
    }
    if (content && (element.prefix || !(svg ? svgTags.has(tag) : element.namespaceURI === XHTML)))
      throw new Error(`Unsupported content element: ${tag}`);
    if (lower === 'style') {
      if (element.namespaceURI === XHTML) policy.htmlStyle(element.textContent || '', entry);
      else policy.css(element.textContent || '', entry);
    }
    if (lower === 'meta' && element.hasAttribute('http-equiv')) {
      const directive = (element.getAttribute('http-equiv') || '').toLowerCase(),
        value = element.getAttribute('content') || '';
      if (
        !(directive === 'content-type' && /^(?:application\/xhtml\+xml|text\/html);\s*charset=utf-8$/i.test(value)) &&
        !(directive === 'content-style-type' && value === 'text/css') &&
        !(directive === 'default-style' && value.length <= 256)
      )
        throw new Error('Active meta policy/navigation');
    }
    if (lower === 'link' && !['stylesheet', 'coverpage'].includes((element.getAttribute('rel') || '').toLowerCase())) {
      if (!policy.manifest.lazy || svg || (!content && entry !== policy.opf))
        throw new Error('Unsupported book resource hint');
      element.remove();
      policy.recordUnavailableAsset();
      continue;
    }
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase(),
        local = attr.localName.toLowerCase();
      if (
        (attr.namespaceURI === 'http://www.w3.org/XML/1998/namespace' && local === 'base') ||
        name.startsWith('on') ||
        local.startsWith('on') ||
        ['srcdoc', 'srcset', 'ping', 'xml:base', 'target', 'download'].includes(name)
      )
        throw new Error(`Active attribute: ${name}`);
      if (content && !svg && attr.name !== name) throw new Error('Unsupported mixed-case XHTML attribute');
      if (svg && !svgAttributes.has(attr.name)) throw new Error(`Unsupported SVG attribute: ${attr.name}`);
      if (local === 'style') policy.css(attr.value, entry, false, 'declarationList');
      if (svg && paintAttributes.has(local)) policy.css(`${local}:${attr.value}`, entry, false, 'declarationList');
      if (local === 'href') {
        if (svg && tag === 'use') {
          if (
            !attr.value.startsWith('#') ||
            doc.getElementById(archiveReference(attr.value, entry).fragment)?.namespaceURI !== SVG
          )
            throw new Error('SVG use must target a local ID');
        } else if (svg && tag === 'image') policy.optionalAsset(attr.value, entry, 'image');
        else if (lower === 'a') {
          if (!passiveExternalLink(attr.value) || policy.manifest.navigation.includes(entry))
            policy.navigation(attr.value, entry);
        } else if (lower === 'link' && (element.getAttribute('rel') || '').toLowerCase() === 'stylesheet')
          policy.optionalStylesheet(attr.value, entry);
        else if (lower === 'link') policy.optionalAsset(attr.value, entry, 'image');
        else if (!(policy.manifest.lazy && lower === 'item' && entry === policy.opf))
          requireResource(attr.value, entry, policy.reader.byName);
      }
      if (local === 'src' && lower === 'img') policy.optionalAsset(attr.value, entry, 'image', false);
      else if (
        local === 'src' &&
        lower === 'content' &&
        element.namespaceURI === 'http://www.daisy.org/z3986/2005/ncx/' &&
        element.parentElement?.localName === 'navPoint'
      )
        policy.navigation(attr.value, entry);
      else if (local === 'src') requireResource(attr.value, entry, policy.reader.byName);
      if (local === 'background') policy.optionalAsset(attr.value, entry, 'image');
      if (local === 'full-path') requireResource(attr.value, '', policy.reader.byName);
    }
    if (lower === 'item' && /scripted|remote-resources/i.test(element.getAttribute('properties') || ''))
      throw new Error('Active package property');
  }
}

export function validateBinary(media: string, value: Uint8Array) {
  const magic = new TextDecoder('latin1').decode(value.slice(0, 12)),
    signature = (prefix: number[]) => prefix.every((byte, index) => value[index] === byte);
  if (
    (media === 'font/woff2' && !signature([119, 79, 70, 50])) ||
    (media === 'font/woff' && !signature([119, 79, 70, 70])) ||
    (media === 'font/ttf' && !signature([0, 1, 0, 0])) ||
    (media === 'font/otf' && !signature([79, 84, 84, 79]))
  )
    throw new Error('Font content/media mismatch');
  if (
    (media === 'image/png' && !signature([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (media === 'image/jpeg' && !(value[0] === 255 && value[1] === 216)) ||
    (media === 'image/gif' && !magic.startsWith('GIF8')) ||
    (media === 'image/webp' && !(magic.startsWith('RIFF') && magic.slice(8) === 'WEBP'))
  )
    throw new Error('Binary image role mismatch');
  return rasterDimensions(media, value);
}
function recordUnavailableResource(manifest: BookManifest) {
  const counts = (manifest.cssDrops ??= {});
  counts.unavailableAsset = (counts.unavailableAsset ?? 0) + 1;
}

function validateStructure(
  documents: Map<string, Document>,
  reader: ArchiveReader,
  metadata: BookManifest,
): ChapterPolicy {
  const data = reader.byName;
  const container = documents.get('META-INF/container.xml');
  if (
    container?.documentElement.localName !== 'container' ||
    container.documentElement.namespaceURI !== 'urn:oasis:names:tc:opendocument:xmlns:container'
  )
    throw new Error('Invalid EPUB container');
  const roots = container.querySelectorAll('rootfiles > rootfile');
  if (
    Array.from(container.querySelectorAll('*')).some(
      (element) =>
        !['container', 'rootfiles', 'rootfile'].includes(element.localName) ||
        element.prefix ||
        element.namespaceURI !== container.documentElement.namespaceURI,
    ) ||
    container.querySelectorAll('rootfiles').length !== 1 ||
    container.querySelectorAll('rootfile').length !== 1 ||
    roots.length !== 1 ||
    roots[0]!.getAttribute('media-type') !== 'application/oebps-package+xml'
  )
    throw new Error('One OPF rootfile is required');
  const opfPath = requireResource(roots[0]!.getAttribute('full-path') || '', '', data);
  const opf = documents.get(opfPath);
  if (
    !opfPath.endsWith('.opf') ||
    opf?.documentElement.localName !== 'package' ||
    opf.documentElement.namespaceURI !== 'http://www.idpf.org/2007/opf'
  )
    throw new Error('Invalid OPF package');
  const root = opf.documentElement;
  const child = (tag: string) =>
    Array.from(root.children).filter(
      (element) => element.localName === tag && element.namespaceURI === root.namespaceURI,
    );
  if (
    ['metadata', 'manifest', 'spine'].some((tag) => child(tag).length !== 1 || opf.querySelectorAll(tag).length !== 1)
  )
    throw new Error('OPF metadata/manifest/spine required');
  const manifest = new Map<string, { path: string; media: string }>(),
    roles = new Map<string, string>();
  const ids = new Set<string>(),
    paths = new Set<string>();
  for (const item of child('manifest')[0]!.children) {
    if (item.localName !== 'item' || item.namespaceURI !== root.namespaceURI || item.prefix || item.children.length)
      throw new Error('Invalid manifest child');
    const id = item.getAttribute('id') || '',
      href = item.getAttribute('href') || '';
    if (!id || ids.has(id) || href.includes('#')) throw new Error('Invalid or duplicate manifest identity/resource');
    ids.add(id);
    let path: string;
    try {
      path = requireResource(href, opfPath, data);
    } catch (error) {
      if (!metadata.lazy) throw error;
      recordUnavailableResource(metadata);
      continue;
    }
    if (paths.has(path)) throw new Error('Invalid or duplicate manifest identity/resource');
    paths.add(path);
    const declaredMedia = item.getAttribute('media-type') || '';
    const media =
      declaredMedia === 'application/x-font-ttf' && /\.ttf$/i.test(path)
        ? 'font/ttf'
        : declaredMedia === 'application/vnd.ms-opentype' && /\.(ttf|otf)$/.test(path)
          ? path.endsWith('.ttf')
            ? 'font/ttf'
            : 'font/otf'
          : declaredMedia;
    const extension = path.split('.').pop()!.toLowerCase();
    if (mediaByExtension[extension] !== media) {
      if (metadata.lazy) {
        recordUnavailableResource(metadata);
        continue;
      }
      throw new Error(`Manifest extension/media-type mismatch (${extension}:${media})`);
    }
    if ((item.getAttribute('properties') || '').split(/\s+/).includes('nav') || media === 'application/x-dtbncx+xml')
      metadata.navigation.push(path);
    if (!metadata.lazy && media === 'application/xhtml+xml') {
      const doc = metadata.documents[path];
      if (doc?.root !== 'html' || doc.namespace !== XHTML || !doc.head || !doc.body)
        throw new Error('Invalid XHTML resource');
    }
    if (
      !metadata.lazy &&
      media === 'image/svg+xml' &&
      (metadata.documents[path]?.root !== 'svg' || metadata.documents[path]?.namespace !== SVG)
    )
      throw new Error('Invalid packaged SVG');
    manifest.set(id, { path, media });
    roles.set(path, media);
  }
  const spine: string[] = [];
  for (const ref of child('spine')[0]!.children) {
    const item = manifest.get(ref.getAttribute('idref') || '');
    if (
      ref.localName !== 'itemref' ||
      ref.namespaceURI !== root.namespaceURI ||
      ref.prefix ||
      ref.children.length ||
      item?.media !== 'application/xhtml+xml'
    )
      throw new Error('Spine must resolve to validated XHTML');
    spine.push(item.path);
  }
  if (!spine.length) throw new Error('Empty spine');
  metadata.roles = [...roles];
  metadata.spine = spine;
  metadata.opf = opfPath;
  return new ChapterPolicy(reader, metadata);
}
