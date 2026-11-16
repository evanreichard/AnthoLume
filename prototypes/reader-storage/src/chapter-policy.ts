import { archiveReference, type ArchiveReference } from './archive-path';
import { supportedCSS, type AssetKind } from './css-policy';
import { requireSafeHTMLStyle } from './body-contract';

export const chapterCSP = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src blob:; style-src 'unsafe-inline' blob:; font-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
const fontTypes = new Set(['font/woff', 'font/woff2', 'font/ttf', 'font/otf']);
const paintAttributes = new Set('fill stroke clip-path mask filter marker-start marker-mid marker-end'.split(' '));

export class ChapterPolicy {
  private urls = new Map<string, string>();
  private building = new Set<string>();
  private dependencies = new Map<string, Set<string>>();
  constructor(readonly data: Map<string, Uint8Array>, readonly documents: Map<string, Document>, readonly roles: Map<string, string>, readonly spine: string[], readonly opf: string) {}
  navigation(value: string, entry: string): ArchiveReference & { index: number } {
    const ref = archiveReference(value, entry);
    const index = this.spine.indexOf(ref.path);
    if (index < 0 || (ref.fragment && !this.documents.get(ref.path)?.getElementById(ref.fragment))) throw new Error('Internal navigation target unavailable');
    return { ...ref, index };
  }
  navigationDocument(value: string): string {
    const ref = archiveReference(value, this.opf);
    if (ref.fragment || !['application/xhtml+xml', 'application/x-dtbncx+xml'].includes(this.roles.get(ref.path) || '') || !this.documents.has(ref.path)) throw new Error('Unvalidated navigation document');
    return ref.path;
  }
  assetReference(value: string, entry: string, kind: AssetKind): ArchiveReference {
    const ref = archiveReference(value, entry);
    if (kind === 'paint') {
      if (!value.startsWith('#') || this.documents.get(entry)?.getElementById(ref.fragment)?.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('SVG paint must reference a local SVG ID');
    } else {
      if (!(kind === 'font' ? fontTypes : imageTypes).has(this.roles.get(ref.path) || '')) throw new Error('Asset role mismatch or unmanifested asset');
      if (ref.fragment && (this.roles.get(ref.path) !== 'image/svg+xml' || !this.documents.get(ref.path)?.getElementById(ref.fragment))) throw new Error('Unsupported or missing asset fragment');
      if (!this.dependencies.has(entry)) this.dependencies.set(entry, new Set());
      this.dependencies.get(entry)!.add(ref.path);
    }
    return ref;
  }
  css(text: string, entry: string, render = false, context: 'stylesheet' | 'declarationList' = 'stylesheet') {
    return supportedCSS(text, (value, kind) => {
      const ref = this.assetReference(value, entry, kind);
      return render && kind !== 'paint' ? this.resourceURL(ref.path) + (ref.fragment ? `#${encodeURIComponent(ref.fragment)}` : '') : value;
    }, context);
  }
  htmlStyle(text: string, entry: string, render = false): string {
    requireSafeHTMLStyle(text);
    const generated = supportedCSS(text, (value, kind) => {
      const ref = this.assetReference(value, entry, kind);
      if (kind === 'paint') return value;
      return render ? this.resourceURL(ref.path) + (ref.fragment ? `#${encodeURIComponent(ref.fragment)}` : '') : 'blob:validated-asset';
    });
    requireSafeHTMLStyle(generated);
    return render ? generated : text;
  }
  stylesheet(value: string, entry: string): string {
    const ref = archiveReference(value, entry);
    if (ref.fragment || this.roles.get(ref.path) !== 'text/css' || !ref.path.endsWith('.css')) throw new Error('Stylesheet must be manifested as CSS');
    return ref.path;
  }
  validateAssetGraph() {
    const pending = new Set<string>(), done = new Set<string>();
    const visit = (path: string) => {
      if (pending.has(path)) throw new Error('Cyclic archive assets are unsupported');
      if (done.has(path)) return;
      pending.add(path);
      for (const target of this.dependencies.get(path) || []) visit(target);
      pending.delete(path); done.add(path);
    };
    for (const path of this.dependencies.keys()) visit(path);
  }
  private resourceURL(path: string): string {
    if (this.urls.has(path)) return this.urls.get(path)!;
    if (this.building.has(path)) throw new Error('Cyclic archive assets are unsupported');
    this.building.add(path);
    const media = this.roles.get(path);
    if (!media || !this.data.has(path)) throw new Error('Missing archive asset');
    let value: BlobPart = this.data.get(path)!.slice().buffer as ArrayBuffer;
    if (media === 'text/css') value = this.css(new TextDecoder('utf-8', { fatal: true }).decode(this.data.get(path)), path, true);
    if (media === 'image/svg+xml') {
      const doc = this.documents.get(path)!.cloneNode(true) as Document;
      this.rewriteAssets(doc, path);
      value = new XMLSerializer().serializeToString(doc);
    }
    const url = URL.createObjectURL(new Blob([value], { type: media }));
    this.urls.set(path, url); this.building.delete(path);
    return url;
  }
  private rewriteAssets(doc: Document, entry: string) {
    for (const element of doc.querySelectorAll('*')) {
      if (element.localName === 'style') element.textContent = element.namespaceURI === 'http://www.w3.org/1999/xhtml' ? this.htmlStyle(element.textContent || '', entry, true) : this.css(element.textContent || '', entry, true);
      for (const attr of Array.from(element.attributes)) {
        const name = attr.localName.toLowerCase();
        let replacement: string | undefined;
        if (name === 'style') replacement = this.css(attr.value, entry, true, 'declarationList');
        if (paintAttributes.has(name)) replacement = this.css(`${name}:${attr.value}`, entry, true, 'declarationList').slice(name.length + 1);
        const svg = element.namespaceURI === 'http://www.w3.org/2000/svg';
        if ((name === 'src' && element.localName === 'img') || name === 'background' || (svg && name === 'href' && element.localName === 'image')) {
          const ref = this.assetReference(attr.value, entry, 'image'); replacement = this.resourceURL(ref.path) + (ref.fragment ? `#${encodeURIComponent(ref.fragment)}` : '');
        }
        if (element.localName === 'link' && name === 'href') {
          const rel = (element.getAttribute('rel') || '').toLowerCase();
          if (rel === 'stylesheet') replacement = this.resourceURL(this.stylesheet(attr.value, entry));
          if (rel === 'coverpage') replacement = this.resourceURL(this.assetReference(attr.value, entry, 'image').path);
        }
        if (replacement !== undefined) element.setAttributeNS(attr.namespaceURI, attr.name, replacement);
      }
    }
  }
  prepareChapter(doc: Document, index: number) {
    const entry = this.spine[index];
    if (!entry) throw new Error('Unvalidated chapter');
    const meta = doc.createElementNS('http://www.w3.org/1999/xhtml', 'meta');
    meta.setAttribute('http-equiv', 'Content-Security-Policy'); meta.setAttribute('content', chapterCSP);
    doc.head.prepend(meta);
    this.rewriteAssets(doc, entry);
  }
  dispose() { for (const url of this.urls.values()) URL.revokeObjectURL(url); this.urls.clear(); }
}
