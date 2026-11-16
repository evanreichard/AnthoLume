import JSZip from 'jszip';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_EXPANDED = 24 * 1024 * 1024;
const passiveTags = new Set(('html head title meta link style body section article nav aside header footer main div p h1 h2 h3 h4 h5 h6 a span em strong b i u s small sub sup br hr img figure figcaption blockquote pre code ol ul li dl dt dd table caption thead tbody tfoot tr td th colgroup col abbr cite q time address ruby rt rp wbr').split(' '));
const urlAttributes = new Set(['href', 'src', 'poster', 'action', 'formaction', 'background', 'cite', 'data', 'xlink:href', 'full-path']);

function resourcePath(value: string, entry: string): string {
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value) || value.startsWith('/')) throw new Error('Unsafe resource URL');
  const url = new URL(value, new URL(entry, 'https://epub.invalid/'));
  if (url.origin !== 'https://epub.invalid' || url.search) throw new Error('Non-archive resource URL');
  return decodeURIComponent(url.pathname.slice(1));
}
function localResource(value: string, entry: string, names: Set<string>): boolean {
  try { return names.has(resourcePath(value, entry)); } catch { return false; }
}
function safeCSS(css: string) {
  // Conservative Subset - Reject functions, at-rules and escaping instead of approximating a CSS URL parser.
  if (/[(@\\]/.test(css) || /-moz-binding|behavior\s*:/i.test(css)) throw new Error('Unsupported CSS resource or active syntax');
}

export async function validateEPUB(bytes: ArrayBuffer): Promise<void> {
  if (bytes.byteLength > MAX_BYTES) throw new Error('EPUB compressed size exceeds proof budget');
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: false });
  const entries = Object.values(zip.files).filter(file => !file.dir);
  if (entries.length > 256) throw new Error('Too many archive entries');
  const names = new Set(entries.map(file => file.name));
  if (await zip.file('mimetype')?.async('string') !== 'application/epub+zip' || !names.has('META-INF/container.xml')) throw new Error('Not an EPUB');
  let expanded = 0;
  const dataByPath = new Map<string, Uint8Array>();
  const documents = new Map<string, Document>();
  for (const file of entries) {
    if (file.name.startsWith('/') || file.name.split('/').includes('..') || file.unsafeOriginalName !== file.name) throw new Error('Unsafe archive path');
    const data = await file.async('uint8array');
    dataByPath.set(file.name, data);
    expanded += data.byteLength;
    if (expanded > MAX_EXPANDED) throw new Error('EPUB expanded size exceeds proof budget');
    if (file.name !== 'mimetype' && !/\.(xhtml|xml|opf|ncx|css|png|jpe?g|gif|webp|woff2?|ttf|otf)$/i.test(file.name)) throw new Error('Unsupported archive resource type');
    if (/\.css$/i.test(file.name)) safeCSS(new TextDecoder('utf-8', { fatal: true }).decode(data));
    if (!/\.(xhtml|xml|opf|ncx)$/i.test(file.name)) continue;
    const text = new TextDecoder().decode(data);
    if (/<!ENTITY|<!DOCTYPE[^>]*\[|<\?(?!xml\s)/i.test(text)) throw new Error('Unsupported XML entity/DTD/processing instruction');
    const doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
    if (doc.querySelector('parsererror')) throw new Error('Invalid XML');
    documents.set(file.name, doc);
    for (const element of doc.querySelectorAll('*')) {
      const tag = element.localName.toLowerCase();
      if ((/\.xhtml$/i.test(file.name) || doc.documentElement.localName.toLowerCase() === 'html') && (element.localName !== tag || !passiveTags.has(tag) || element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || element.prefix)) throw new Error(`Unsupported content element: ${tag}`);
      if (tag === 'style') safeCSS(element.textContent || '');
      for (const attr of Array.from(element.attributes)) {
        const name = attr.name.toLowerCase();
        if (name !== attr.name || name.startsWith('on') || ['http-equiv', 'srcdoc', 'srcset', 'ping', 'xml:base', 'target', 'download'].includes(name)) throw new Error(`Active attribute: ${name}`);
        if (name === 'style') safeCSS(attr.value);
        if (urlAttributes.has(name) && !localResource(attr.value, name === 'full-path' ? '' : file.name, names)) throw new Error(`Non-archive URL rejected: ${name}`);
      }
      if (tag === 'item') {
        if (/scripted|remote-resources/i.test(element.getAttribute('properties') || '')) throw new Error('Active package property');
        if (element.getAttribute('media-type') === 'application/xhtml+xml' && !/\.xhtml(?:#.*)?$/i.test(element.getAttribute('href') || '')) throw new Error('XHTML must use the validated XHTML resource path');
      }
    }
  }
  validateStructure(documents, dataByPath);
}

const mediaByExtension: Record<string, string> = {
  xhtml: 'application/xhtml+xml', css: 'text/css', ncx: 'application/x-dtbncx+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf'
};
function validateStructure(documents: Map<string, Document>, data: Map<string, Uint8Array>) {
  const container = documents.get('META-INF/container.xml');
  if (container?.documentElement.localName !== 'container' || container.documentElement.namespaceURI !== 'urn:oasis:names:tc:opendocument:xmlns:container') throw new Error('Invalid EPUB container');
  const roots = container.querySelectorAll('rootfiles > rootfile');
  if (Array.from(container.querySelectorAll('*')).some(element => !['container', 'rootfiles', 'rootfile'].includes(element.localName) || element.prefix || element.namespaceURI !== container.documentElement.namespaceURI) || container.querySelectorAll('rootfiles').length !== 1 || container.querySelectorAll('rootfile').length !== 1 || roots.length !== 1 || roots[0]!.getAttribute('media-type') !== 'application/oebps-package+xml') throw new Error('One OPF rootfile is required');
  const opfPath = resourcePath(roots[0]!.getAttribute('full-path') || '', '');
  const opf = documents.get(opfPath);
  if (!opfPath.endsWith('.opf') || opf?.documentElement.localName !== 'package' || opf.documentElement.namespaceURI !== 'http://www.idpf.org/2007/opf') throw new Error('Invalid OPF package');
  const root = opf.documentElement;
  const child = (tag: string) => Array.from(root.children).filter(element => element.localName === tag && element.namespaceURI === root.namespaceURI);
  if (['metadata', 'manifest', 'spine'].some(tag => child(tag).length !== 1 || opf.querySelectorAll(tag).length !== 1)) throw new Error('OPF metadata/manifest/spine required');
  const manifest = new Map<string, { path: string; media: string }>();
  const roles = new Map<string, string>();
  for (const item of child('manifest')[0]!.children) {
    if (item.localName !== 'item' || item.namespaceURI !== root.namespaceURI || item.prefix || item.children.length) throw new Error('Invalid manifest child');
    const id = item.getAttribute('id') || '';
    const href = item.getAttribute('href') || '';
    const path = resourcePath(href, opfPath);
    const media = item.getAttribute('media-type') || '';
    if (!id || manifest.has(id) || roles.has(path) || href.includes('#') || !data.has(path)) throw new Error('Invalid or duplicate manifest identity/resource');
    // Effective Role - CSS is checked even when a malicious manifest aliases it as an image filename.
    if (media === 'text/css') safeCSS(new TextDecoder('utf-8', { fatal: true }).decode(data.get(path)!));
    const extension = path.split('.').pop()!;
    if (mediaByExtension[extension] !== media) throw new Error('Manifest extension/media-type mismatch');
    if (media === 'application/xhtml+xml') {
      const doc = documents.get(path);
      if (doc?.documentElement.localName !== 'html' || doc.documentElement.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !doc.querySelector('html > head') || !doc.querySelector('html > body')) throw new Error('Invalid XHTML resource');
    }
    manifest.set(id, { path, media }); roles.set(path, media);
  }
  const spine = Array.from(child('spine')[0]!.children);
  if (!spine.length) throw new Error('Empty spine');
  for (const ref of spine) {
    const item = manifest.get(ref.getAttribute('idref') || '');
    if (ref.localName !== 'itemref' || ref.namespaceURI !== root.namespaceURI || ref.prefix || ref.children.length || item?.media !== 'application/xhtml+xml') throw new Error('Spine must resolve to validated XHTML');
  }
  for (const [path, doc] of documents) for (const link of doc.querySelectorAll('link')) {
    if (!(link.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('stylesheet')) continue;
    const target = resourcePath(link.getAttribute('href') || '', path);
    if (!data.has(target)) throw new Error('Missing stylesheet');
    safeCSS(new TextDecoder('utf-8', { fatal: true }).decode(data.get(target)!));
    if (!target.endsWith('.css') || roles.get(target) !== 'text/css') throw new Error('Stylesheet must be manifested as CSS');
  }
}

export const chapterCSP = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src blob: data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function secureChapter(doc: Document) {
  const meta = doc.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', chapterCSP);
  doc.head.prepend(meta);
}
