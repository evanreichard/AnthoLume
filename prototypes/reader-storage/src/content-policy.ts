import JSZip from 'jszip';
import { archiveReference } from './archive-path';
import { ChapterPolicy } from './chapter-policy';
import { requireStableBody } from './body-contract';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED = 24 * 1024 * 1024;
const XHTML = 'http://www.w3.org/1999/xhtml', SVG = 'http://www.w3.org/2000/svg';
const passiveTags = new Set('html head title meta link style body section article nav aside header footer main div p h1 h2 h3 h4 h5 h6 a span em strong b i u s small sub sup br hr img figure figcaption blockquote pre code ol ul li dl dt dd table caption thead tbody tfoot tr td th colgroup col abbr cite q time address ruby rt rp wbr ins del'.split(' '));
const svgTags = new Set('svg g defs symbol use image title desc style path rect circle ellipse line polyline polygon text tspan linearGradient radialGradient stop clipPath'.split(' '));
const svgAttributes = new Set('xmlns xmlns:xlink xml:lang id class style viewBox preserveAspectRatio width height x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-rule fill-opacity stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin opacity clip-path clip-rule offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod href xlink:href font-family font-size text-anchor role aria-label'.split(' '));
const activeTags = new Set('script base iframe frame frameset object embed form input button textarea select foreignobject animate animatetransform animatemotion set'.split(' '));
const paintAttributes = new Set('fill stroke clip-path mask filter marker-start marker-mid marker-end'.split(' '));
const mediaByExtension: Record<string, string> = {
  xhtml: 'application/xhtml+xml', html: 'application/xhtml+xml', css: 'text/css', ncx: 'application/x-dtbncx+xml', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf'
};
function text(data: Uint8Array) { return new TextDecoder('utf-8', { fatal: true }).decode(data); }
function requireResource(value: string, entry: string, data: Map<string, Uint8Array>) {
  const ref = archiveReference(value, entry);
  if (!data.has(ref.path)) throw new Error('Missing archive resource');
  return ref.path;
}

export async function validateEPUB(bytes: ArrayBuffer): Promise<ChapterPolicy> {
  if (bytes.byteLength > MAX_BYTES) throw new Error('EPUB compressed size exceeds proof budget');
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  const entries = Object.values(zip.files).filter(file => !file.dir);
  if (entries.length > 256) throw new Error('Too many archive entries');
  if (await zip.file('mimetype')?.async('string') !== 'application/epub+zip' || !zip.file('META-INF/container.xml')) throw new Error('Not an EPUB');
  let expanded = 0;
  const data = new Map<string, Uint8Array>(), documents = new Map<string, Document>();
  for (const file of entries) {
    if (file.name.startsWith('/') || file.name.split('/').includes('..') || file.unsafeOriginalName !== file.name) throw new Error('Unsafe archive path');
    const value = await file.async('uint8array'); data.set(file.name, value);
    expanded += value.byteLength;
    if (expanded > MAX_EXPANDED) throw new Error('EPUB expanded size exceeds proof budget');
    if (file.name !== 'mimetype' && !/\.(xhtml|html|xml|opf|ncx|css|svg|png|jpe?g|gif|webp|woff2?|ttf|otf)$/i.test(file.name)) throw new Error('Unsupported archive resource type');
    if (!/\.(xhtml|html|xml|opf|ncx|svg)$/i.test(file.name)) continue;
    const source = text(value);
    if (/<!ENTITY|<!DOCTYPE[^>]*\[|<\?(?!xml\s)/i.test(source)) throw new Error('Unsupported XML entity/DTD/processing instruction');
    const doc = new DOMParser().parseFromString(source, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) throw new Error('Invalid XML');
    documents.set(file.name, doc);
  }
  const policy = validateStructure(documents, data);
  for (const [path, doc] of documents) {
    validateDocument(doc, path, policy);
    if (doc.documentElement.namespaceURI === XHTML) requireStableBody(doc);
  }
  for (const [path, value] of data) if (path.endsWith('.css')) policy.css(text(value), path);
  policy.validateAssetGraph();
  return policy;
}

function validateDocument(doc: Document, entry: string, policy: ChapterPolicy) {
  const content = doc.documentElement.namespaceURI === XHTML || doc.documentElement.namespaceURI === SVG;
  for (const element of doc.querySelectorAll('*')) {
    const tag = element.localName, lower = tag.toLowerCase(), svg = element.namespaceURI === SVG;
    if (activeTags.has(lower)) throw new Error(`Active content element: ${tag}`);
    if (content && (element.prefix || !(svg ? svgTags.has(tag) : element.namespaceURI === XHTML && passiveTags.has(tag)))) throw new Error(`Unsupported content element: ${tag}`);
    if (lower === 'style') {
      if (element.namespaceURI === XHTML) policy.htmlStyle(element.textContent || '', entry);
      else policy.css(element.textContent || '', entry);
    }
    if (lower === 'meta' && element.hasAttribute('http-equiv')) {
      const directive = (element.getAttribute('http-equiv') || '').toLowerCase(), value = element.getAttribute('content') || '';
      if (!(directive === 'content-type' && /^(?:application\/xhtml\+xml|text\/html);\s*charset=utf-8$/i.test(value)) && !(directive === 'content-style-type' && value === 'text/css')) throw new Error('Active meta policy/navigation');
    }
    if (lower === 'link' && !['stylesheet', 'coverpage'].includes((element.getAttribute('rel') || '').toLowerCase())) throw new Error('Unsupported book resource hint');
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase(), local = attr.localName.toLowerCase();
      if ((attr.namespaceURI === 'http://www.w3.org/XML/1998/namespace' && local === 'base') || name.startsWith('on') || local.startsWith('on') || ['srcdoc', 'srcset', 'ping', 'xml:base', 'target', 'download'].includes(name)) throw new Error(`Active attribute: ${name}`);
      if (content && !svg && attr.name !== name) throw new Error('Unsupported mixed-case XHTML attribute');
      if (svg && !svgAttributes.has(attr.name)) throw new Error(`Unsupported SVG attribute: ${attr.name}`);
      if (local === 'style') policy.css(attr.value, entry, false, 'declarationList');
      if (svg && paintAttributes.has(local)) policy.css(`${local}:${attr.value}`, entry, false, 'declarationList');
      if (local === 'href') {
        if (svg && tag === 'use') {
          if (!attr.value.startsWith('#') || doc.getElementById(archiveReference(attr.value, entry).fragment)?.namespaceURI !== SVG) throw new Error('SVG use must target a local ID');
        } else if (svg && tag === 'image') policy.assetReference(attr.value, entry, 'image');
        else if (lower === 'a') policy.navigation(attr.value, entry);
        else if (lower === 'link' && (element.getAttribute('rel') || '').toLowerCase() === 'stylesheet') { const path = policy.stylesheet(attr.value, entry); policy.css(text(policy.data.get(path)!), path); }
        else if (lower === 'link') policy.assetReference(attr.value, entry, 'image');
        else requireResource(attr.value, entry, policy.data);
      }
      if (local === 'src' && lower === 'img') policy.assetReference(attr.value, entry, 'image');
      else if (local === 'src' && lower === 'content' && element.namespaceURI === 'http://www.daisy.org/z3986/2005/ncx/' && element.parentElement?.localName === 'navPoint') policy.navigation(attr.value, entry);
      else if (local === 'src') requireResource(attr.value, entry, policy.data);
      if (local === 'background') policy.assetReference(attr.value, entry, 'image');
      if (local === 'full-path') requireResource(attr.value, '', policy.data);
    }
    if (lower === 'item' && /scripted|remote-resources/i.test(element.getAttribute('properties') || '')) throw new Error('Active package property');
  }
}

function validateStructure(documents: Map<string, Document>, data: Map<string, Uint8Array>): ChapterPolicy {
  const container = documents.get('META-INF/container.xml');
  if (container?.documentElement.localName !== 'container' || container.documentElement.namespaceURI !== 'urn:oasis:names:tc:opendocument:xmlns:container') throw new Error('Invalid EPUB container');
  const roots = container.querySelectorAll('rootfiles > rootfile');
  if (Array.from(container.querySelectorAll('*')).some(element => !['container', 'rootfiles', 'rootfile'].includes(element.localName) || element.prefix || element.namespaceURI !== container.documentElement.namespaceURI) || container.querySelectorAll('rootfiles').length !== 1 || container.querySelectorAll('rootfile').length !== 1 || roots.length !== 1 || roots[0]!.getAttribute('media-type') !== 'application/oebps-package+xml') throw new Error('One OPF rootfile is required');
  const opfPath = requireResource(roots[0]!.getAttribute('full-path') || '', '', data);
  const opf = documents.get(opfPath);
  if (!opfPath.endsWith('.opf') || opf?.documentElement.localName !== 'package' || opf.documentElement.namespaceURI !== 'http://www.idpf.org/2007/opf') throw new Error('Invalid OPF package');
  const root = opf.documentElement;
  const child = (tag: string) => Array.from(root.children).filter(element => element.localName === tag && element.namespaceURI === root.namespaceURI);
  if (['metadata', 'manifest', 'spine'].some(tag => child(tag).length !== 1 || opf.querySelectorAll(tag).length !== 1)) throw new Error('OPF metadata/manifest/spine required');
  const manifest = new Map<string, { path: string; media: string }>(), roles = new Map<string, string>();
  for (const item of child('manifest')[0]!.children) {
    if (item.localName !== 'item' || item.namespaceURI !== root.namespaceURI || item.prefix || item.children.length) throw new Error('Invalid manifest child');
    const id = item.getAttribute('id') || '', href = item.getAttribute('href') || '';
    const path = requireResource(href, opfPath, data), media = item.getAttribute('media-type') || '';
    if (!id || manifest.has(id) || roles.has(path) || href.includes('#')) throw new Error('Invalid or duplicate manifest identity/resource');
    const extension = path.split('.').pop()!;
    if (mediaByExtension[extension] !== media) throw new Error('Manifest extension/media-type mismatch');
    if (media === 'application/xhtml+xml') {
      const doc = documents.get(path);
      if (doc?.documentElement.localName !== 'html' || doc.documentElement.namespaceURI !== XHTML || !doc.querySelector('html > head') || !doc.querySelector('html > body')) throw new Error('Invalid XHTML resource');
    }
    if (media === 'image/svg+xml' && (documents.get(path)?.documentElement.localName !== 'svg' || documents.get(path)?.documentElement.namespaceURI !== SVG)) throw new Error('Invalid packaged SVG');
    const value = data.get(path)!;
    const magic = new TextDecoder('latin1').decode(value.slice(0, 12));
    const signature = (prefix: number[]) => prefix.every((byte, index) => value[index] === byte);
    if ((media === 'font/woff2' && !signature([119, 79, 70, 50])) || (media === 'font/woff' && !signature([119, 79, 70, 70])) || (media === 'font/ttf' && !signature([0, 1, 0, 0])) || (media === 'font/otf' && !signature([79, 84, 84, 79]))) throw new Error('Font content/media mismatch');
    if ((media === 'image/png' && !signature([137, 80, 78, 71, 13, 10, 26, 10])) || (media === 'image/jpeg' && !(value[0] === 255 && value[1] === 216)) || (media === 'image/gif' && !magic.startsWith('GIF8')) || (media === 'image/webp' && !(magic.startsWith('RIFF') && magic.slice(8) === 'WEBP'))) throw new Error('Binary image role mismatch');
    manifest.set(id, { path, media }); roles.set(path, media);
  }
  const spine: string[] = [];
  for (const ref of child('spine')[0]!.children) {
    const item = manifest.get(ref.getAttribute('idref') || '');
    if (ref.localName !== 'itemref' || ref.namespaceURI !== root.namespaceURI || ref.prefix || ref.children.length || item?.media !== 'application/xhtml+xml') throw new Error('Spine must resolve to validated XHTML');
    spine.push(item.path);
  }
  if (!spine.length) throw new Error('Empty spine');
  return new ChapterPolicy(data, documents, roles, spine, opfPath);
}
