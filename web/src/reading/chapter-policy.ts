import { archiveReference, type ArchiveReference } from './archive-path';
import { supportedCSS, type AssetKind, type CSSDropReason } from './css-policy';
import { requireSafeHTMLStyle } from './body-contract';
import { ArchiveReader, sourceLimits } from './source';
import type { BookManifest } from './book-manifest';
import { documentInfo, parseDocument, validateBinary, validateLoadedDocument } from './content-policy';
import { mediaLimits } from './media-budget';
export function passiveExternalLink(value: string) { try { const url = new URL(value); return ['http:', 'https:', 'mailto:'].includes(url.protocol) && !/[\u0000-\u0020\u007f]/.test(value); } catch { return false; } }
export const chapterCSP = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src blob:; style-src 'unsafe-inline' blob:; font-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
const fontTypes = new Set(['font/woff', 'font/woff2', 'font/ttf', 'font/otf']);
const paintAttributes = new Set('fill stroke clip-path mask filter marker-start marker-mid marker-end'.split(' '));
export class ChapterPolicy {
  private urls = new Map<string, { url: string; bytes: number; owners: Set<string> }>();
  private building = new Set<string>();
  private dependencyBytes = 0;
  private dependencyEdges = 0;
  readonly dependencies: Map<string, Set<string>>;
  readonly staticDependencies: Map<string, Set<string>>;
  private images = new Map<string, { index: number; path: string; fragment: string; placeholder: string }[]>();
  private decoded = new Map<string, Promise<void>>();
  readonly roles: Map<string, string>;
  readonly spine: string[];
  readonly opf: string;
  private infoBytes = 0;
  private validatedAssets = new Set<string>();
  private unavailableAssets = new Set<string>();
  private documents = new Map<string, { document: Document; bytes: number }>();
  readonly stats = { cachedDOMs: 0, cachedDOMBytes: 0, assetBytes: 0, urls: 0, peakDOMs: 0, peakAssetBytes: 0 };
  constructor(readonly reader: ArchiveReader, readonly manifest: BookManifest) {
    this.roles = new Map(manifest.roles); this.spine = manifest.spine; this.opf = manifest.opf;
    this.dependencies = new Map(manifest.dependencies.map(([name, paths]) => [name, new Set(paths)]));
    this.staticDependencies = new Map(manifest.staticDependencies.map(([name, paths]) => [name, new Set(paths)]));
  }
  allowsDocument(path: string) {
    return this.manifest.lazy
      ? path === this.opf || ['application/xhtml+xml', 'application/x-dtbncx+xml'].includes(this.roles.get(path) || '')
      : Object.hasOwn(this.manifest.documents, path);
  }
  async document(path: string): Promise<Document> {
    const cached = this.documents.get(path);
    if (cached) { this.documents.delete(path); this.documents.set(path, cached); return cached.document; }
    const bytes = await this.reader.bytes(path), document = parseDocument(bytes);
    if (this.manifest.lazy && path !== this.opf) {
      const info = documentInfo(document, bytes.length), previous = this.manifest.documents[path];
      const size = previous ? 0 : new Blob([JSON.stringify(info)]).size;
      if (this.infoBytes + size > 8 * 1024 * 1024) throw new Error('Document identity metadata exceeds 8 MiB');
      // Local SVG paint checks need IDs from this document, but failed validation must not publish them.
      this.manifest.documents[path] = info;
      try { validateLoadedDocument(document, path, this, info); }
      catch (error) { if (previous) this.manifest.documents[path] = previous; else delete this.manifest.documents[path]; throw error; }
      this.infoBytes += size;
    }
    while (this.documents.size >= 2 || this.stats.cachedDOMBytes + bytes.length > sourceLimits.chapterBytes) { const key = this.documents.keys().next().value; if (!key) break; this.stats.cachedDOMBytes -= this.documents.get(key)!.bytes; this.documents.delete(key); }
    this.documents.set(path, { document, bytes: bytes.length }); this.stats.cachedDOMBytes += bytes.length; this.stats.cachedDOMs = this.documents.size; this.stats.peakDOMs = Math.max(this.stats.peakDOMs, this.documents.size); return document;
  }
  clearDocuments() { this.documents.clear(); this.stats.cachedDOMBytes = 0; this.stats.cachedDOMs = 0; }
  navigation(value: string, entry: string): ArchiveReference & { index: number } {
    const ref = archiveReference(value, entry), index = this.spine.indexOf(ref.path);
    if (index < 0 || ref.fragment && !this.manifest.lazy && !this.manifest.documents[ref.path]?.ids.includes(ref.fragment)) throw new Error('Internal navigation target unavailable');
    return { ...ref, index };
  }
  navigationDocument(value: string): string {
    const ref = archiveReference(value, this.opf);
    if (ref.fragment || !['application/xhtml+xml', 'application/x-dtbncx+xml'].includes(this.roles.get(ref.path) || '') || !this.manifest.documents[ref.path]) throw new Error('Unvalidated navigation document'); return ref.path;
  }
  assetReference(value: string, entry: string, kind: AssetKind, isStatic = true): ArchiveReference {
    const ref = archiveReference(value, entry);
    if (kind === 'paint') {
      if (!value.startsWith('#') || !this.manifest.documents[entry]?.svgIds.includes(ref.fragment)) throw new Error('SVG paint must reference a local SVG ID');
    } else {
      if (!(kind === 'font' ? fontTypes : imageTypes).has(this.roles.get(ref.path) || '')) throw new Error('Asset role mismatch or unmanifested asset');
      if (ref.fragment && (this.roles.get(ref.path) !== 'image/svg+xml' || !this.manifest.lazy && !this.manifest.documents[ref.path]?.ids.includes(ref.fragment))) throw new Error('Unsupported or missing asset fragment');
      this.addDependency(entry, ref.path, isStatic);
    }
    return ref;
  }
  private optional<T>(resolve: () => T): T | null {
    try { return resolve(); } catch (error) {
      this.reader.signal?.throwIfAborted();
      if (!this.manifest.lazy) throw error;
      this.countCSSDrop('unavailableAsset');
      return null;
    }
  }
  optionalAsset(value: string, entry: string, kind: AssetKind, isStatic = true) {
    if (kind === 'paint') return this.assetReference(value, entry, kind, isStatic);
    return this.optional(() => {
      const ref = this.assetReference(value, entry, kind, isStatic);
      return this.unavailableAssets.has(ref.path) ? null : ref;
    });
  }
  optionalStylesheet(value: string, entry: string) {
    return this.optional(() => {
      const path = this.stylesheet(value, entry);
      return this.unavailableAssets.has(path) ? null : path;
    });
  }
  private requireFragment(ref: ArchiveReference) {
    if (ref.fragment && !this.manifest.documents[ref.path]?.svgIds.includes(ref.fragment)) throw new Error('Unsupported or missing asset fragment');
  }
  private url(path: string) { const value = this.urls.get(path); if (!value) throw new Error('Asset not leased before chapter serialization'); return value.url; }
  recordUnavailableAsset() { this.countCSSDrop('unavailableAsset'); }
  private countCSSDrop = (reason: CSSDropReason) => {
    const counts = this.manifest.cssDrops ??= {};
    counts[reason] = (counts[reason] ?? 0) + 1;
  };
  css(text: string, entry: string, render = false, context: 'stylesheet' | 'declarationList' = 'stylesheet') {
    return supportedCSS(text, (value, kind) => { const ref = this.optionalAsset(value, entry, kind); if (!ref) return null; if (render && kind !== 'paint') this.requireFragment(ref); return render && kind !== 'paint' ? this.url(ref.path) + (ref.fragment ? `#${encodeURIComponent(ref.fragment)}` : '') : value; }, context, render ? undefined : this.countCSSDrop);
  }
  htmlStyle(text: string, entry: string, render = false): string {
    requireSafeHTMLStyle(text);
    const generated = supportedCSS(text, (value, kind) => { const ref = this.optionalAsset(value, entry, kind); if (!ref) return null; if (render && kind !== 'paint') this.requireFragment(ref); return kind === 'paint' ? value : render ? this.url(ref.path) + (ref.fragment ? `#${encodeURIComponent(ref.fragment)}` : '') : 'blob:validated-asset'; }, 'stylesheet', render ? undefined : this.countCSSDrop);
    requireSafeHTMLStyle(generated); return render ? generated : text;
  }
  stylesheet(value: string, entry: string): string {
    const ref = archiveReference(value, entry);
    if (ref.fragment || this.roles.get(ref.path) !== 'text/css' || !ref.path.endsWith('.css')) throw new Error('Stylesheet must be manifested as CSS');
    this.addDependency(entry, ref.path, true); return ref.path;
  }
  private addDependency(entry: string, path: string, isStatic: boolean) {
    for (const graph of isStatic ? [this.dependencies, this.staticDependencies] : [this.dependencies]) {
      if (graph.get(entry)?.has(path)) continue;
      this.dependencyBytes += 64 + (entry.length + path.length) * 2;
      if (this.dependencyBytes > 8 * 1024 * 1024 || graph === this.dependencies && ++this.dependencyEdges > 131072) throw new Error('Asset dependency metadata budget exceeded');
      if (!graph.has(entry)) graph.set(entry, new Set()); graph.get(entry)!.add(path);
    }
  }
  validateAssetGraph() {
    const pending = new Set<string>(), done = new Set<string>(); let edges = 0;
    const visit = (path: string, depth: number) => { if (pending.has(path) || depth > 64) throw new Error('Cyclic/deep archive assets are unsupported'); if (done.has(path)) return; pending.add(path); for (const target of this.dependencies.get(path) || []) { if (++edges > 131072) throw new Error('Asset graph budget exceeded'); visit(target, depth + 1); } pending.delete(path); done.add(path); };
    for (const path of this.dependencies.keys()) visit(path, 0);
  }
  private async validateAsset(path: string, pending: Set<string>) {
    if (pending.has(path) || pending.size >= 64) throw new Error('Cyclic/deep archive assets are unsupported');
    if (this.validatedAssets.has(path) || this.unavailableAssets.has(path)) return;
    pending.add(path);
    try {
      const media = this.roles.get(path);
      if (!media || !(media === 'text/css' || imageTypes.has(media) || fontTypes.has(media))) throw new Error('Invalid chapter asset role');
      if (media === 'image/svg+xml') await this.document(path);
      else {
        const bytes = await this.reader.bytes(path);
        if (media === 'text/css') this.css(new TextDecoder('utf-8', { fatal: true }).decode(bytes), path);
        else {
          const dimensions = validateBinary(media, bytes);
          if (dimensions) {
            this.manifest.images[path] = dimensions;
            this.manifest.pixels[path] = dimensions.width * dimensions.height;
          }
        }
      }
      for (const child of this.dependencies.get(path) || []) await this.validateAsset(child, pending);
      this.validatedAssets.add(path);
    } catch (error) {
      this.reader.signal?.throwIfAborted();
      if (!this.manifest.lazy) throw error;
      this.unavailableAssets.add(path);
      this.countCSSDrop('unavailableAsset');
    } finally { pending.delete(path); }
  }
  private async acquire(path: string, owner: string) {
    if (this.unavailableAssets.has(path)) return;
    const cached = this.urls.get(path); if (cached) { cached.owners.add(owner); return; }
    if (this.building.has(path)) throw new Error('Cyclic archive assets are unsupported'); this.building.add(path);
    try {
      for (const dependency of this.dependencies.get(path) || []) await this.acquire(dependency, owner);
      const media = this.roles.get(path); if (!media) throw new Error('Missing archive asset');
      let value: BlobPart;
      if (media === 'image/svg+xml') { const doc = (await this.document(path)).cloneNode(true) as Document; this.rewriteAssets(doc, path); value = new XMLSerializer().serializeToString(doc); }
      else { const bytes = await this.reader.bytes(path); value = media === 'text/css' ? this.css(new TextDecoder('utf-8', { fatal: true }).decode(bytes), path, true) : bytes; }
      const blob = new Blob([value], { type: media });
      if (this.stats.assetBytes + blob.size > sourceLimits.assetBytes * 2) throw new Error('Active chapter asset cache budget exceeded');
      this.urls.set(path, { url: URL.createObjectURL(blob), bytes: blob.size, owners: new Set([owner]) }); this.stats.assetBytes += blob.size; this.stats.urls = this.urls.size; this.stats.peakAssetBytes = Math.max(this.stats.peakAssetBytes, this.stats.assetBytes);
    } finally { this.building.delete(path); }
  }
  private intrinsic(path: string, owner: string) {
    const { width, height } = this.manifest.images[path]!, key = `\u0000intrinsic:${width}:${height}`;
    let value = this.urls.get(key);
    if (!value) {
      const blob = new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`], { type: 'image/svg+xml' });
      value = { url: URL.createObjectURL(blob), bytes: blob.size, owners: new Set() }; this.urls.set(key, value);
      this.stats.assetBytes += blob.size; this.stats.urls = this.urls.size; this.stats.peakAssetBytes = Math.max(this.stats.peakAssetBytes, this.stats.assetBytes);
    }
    value.owners.add(owner); return value.url;
  }
  private rewriteAssets(doc: Document, entry: string, lazy = false) {
    const imageOrder = new Map(Array.from(doc.querySelectorAll('img')).map((image, index) => [image, index]));
    for (const element of doc.querySelectorAll('*')) {
      if (element.localName === 'style') element.textContent = element.namespaceURI === 'http://www.w3.org/1999/xhtml' ? this.htmlStyle(element.textContent || '', entry, true) : this.css(element.textContent || '', entry, true);
      for (const attr of Array.from(element.attributes)) {
        const name = attr.localName.toLowerCase(); let replacement: string | undefined;
        // Passive Links - Keep authored bytes/tree/text; live external hrefs become non-fetching absent fragments, including native context-menu paths.
        if (element.localName === 'a' && name === 'href' && passiveExternalLink(attr.value)) replacement = `#antholume-unavailable-${crypto.randomUUID()}`;
        if (name === 'style') replacement = this.css(attr.value, entry, true, 'declarationList');
        if (paintAttributes.has(name)) replacement = this.css(`${name}:${attr.value}`, entry, true, 'declarationList').slice(name.length + 1);
        const svg = element.namespaceURI === 'http://www.w3.org/2000/svg';
        if (name === 'src' && element.localName === 'img' || name === 'background' || svg && name === 'href' && element.localName === 'image') {
          const ref = this.optionalAsset(attr.value, entry, 'image', element.localName !== 'img');
          if (!ref) { element.removeAttributeNode(attr); continue; }
          const dimensions = this.manifest.images[ref.path];
          this.requireFragment(ref);
          if (lazy && element.localName === 'img' && dimensions) {
            const placeholder = this.intrinsic(ref.path, entry);
            this.images.get(entry)!.push({ index: imageOrder.get(element as HTMLImageElement)!, ...ref, placeholder });
            element.setAttribute('src', placeholder); continue;
          }
          replacement = this.url(ref.path) + (ref.fragment ? `#${encodeURIComponent(ref.fragment)}` : '');
        }
        if (element.localName === 'link' && name === 'href') {
          const rel = (element.getAttribute('rel') || '').toLowerCase();
          const path = rel === 'stylesheet' ? this.optionalStylesheet(attr.value, entry) : this.optionalAsset(attr.value, entry, 'image')?.path;
          if (!path) { element.removeAttributeNode(attr); continue; }
          replacement = this.url(path);
        }
        if (replacement !== undefined) element.setAttributeNS(attr.namespaceURI, attr.name, replacement);
      }
    }
  }
  async prepareChapter(doc: Document, index: number) {
    const entry = this.spine[index]; if (!entry) throw new Error('Unvalidated chapter');
    if (this.manifest.lazy) for (const path of this.dependencies.get(entry) || []) await this.validateAsset(path, new Set());
    const closure = new Set<string>();
    const collect = (path: string, root = false) => { for (const dependency of (root ? this.staticDependencies : this.dependencies).get(path) || []) if (!closure.has(dependency) && !this.unavailableAssets.has(dependency)) { closure.add(dependency); collect(dependency); } }; collect(entry, true);
    for (const image of doc.querySelectorAll('img[src]')) { const ref = this.optionalAsset(image.getAttribute('src')!, entry, 'image', false); if (ref && !this.manifest.images[ref.path]) { closure.add(ref.path); collect(ref.path); } }
    this.images.set(entry, []);
    if ([...closure].reduce((n, path) => n + (this.manifest.pixels[path] || 0), 0) > mediaLimits.totalPixels) throw new Error('Active chapter decoded-pixel budget exceeded');
    if ([...closure].reduce((n, path) => n + (this.reader.byName.get(path)?.expanded || 0), 0) > sourceLimits.assetBytes) throw new Error('Chapter resource working set exceeds 32 MiB');
    try { for (const path of closure) await this.acquire(path, entry); } catch (error) { this.releaseChapter(entry); throw error; }
    const meta = doc.createElementNS('http://www.w3.org/1999/xhtml', 'meta'); meta.setAttribute('http-equiv', 'Content-Security-Policy'); meta.setAttribute('content', chapterCSP); doc.head.prepend(meta); this.rewriteAssets(doc, entry, true);
  }
  async loadVisible(doc: Document, entry: string, frame: HTMLIFrameElement, viewport: DOMRect) {
    for (const image of Array.from(doc.images)) if (image.hasAttribute('src') && (!image.complete || !image.naturalWidth)) await image.decode();
    for (const image of doc.querySelectorAll<SVGImageElement>('svg image')) if (image.href.baseVal) await this.decodeURL(image.href.baseVal);
    const origin = frame.getBoundingClientRect(), visible: { image: HTMLImageElement; target: { index: number; path: string; fragment: string }; owner: string }[] = [];
    for (const target of this.images.get(entry) || []) {
      const image = doc.images[target.index]; if (!image) throw new Error('Chapter image identity changed');
      const owner = `${entry}\u0000${target.index}`;
      if (Array.from(image.getClientRects()).some(rect => rect.right + origin.left > viewport.left && rect.left + origin.left < viewport.right && rect.bottom + origin.top > viewport.top && rect.top + origin.top < viewport.bottom)) visible.push({ image, target, owner });
      else { if (image.getAttribute('src') !== target.placeholder) { image.setAttribute('src', target.placeholder); await image.decode(); } this.releaseOwner(owner); }
    }
    const needed = new Set<string>();
    const collect = (path: string) => { if (needed.has(path)) return; needed.add(path); for (const child of this.dependencies.get(path) || []) collect(child); };
    for (const row of visible) collect(row.target.path);
    for (const [path, value] of this.urls) if (value.owners.has(entry)) needed.add(path);
    if ([...needed].reduce((n, path) => n + (this.manifest.pixels[path] || 0), 0) > mediaLimits.totalPixels) throw new Error('Visible page decoded-pixel budget exceeded');
    if ([...needed].reduce((n, path) => n + (this.reader.byName.get(path)?.expanded || 0), 0) > sourceLimits.assetBytes) throw new Error('Visible page resource working set exceeds 32 MiB');
    for (const { image, target, owner } of visible) { await this.acquire(target.path, owner); const src = this.url(target.path) + (target.fragment ? `#${encodeURIComponent(target.fragment)}` : ''); if (image.getAttribute('src') !== src) image.setAttribute('src', src); await image.decode(); }
    for (const image of Array.from(doc.images)) if (image.hasAttribute('src') && this.isVisible(image, frame, viewport)) await image.decode();
    for (const image of doc.querySelectorAll<SVGImageElement>('svg image')) if (image.href.baseVal && this.isVisible(image, frame, viewport)) await this.decodeURL(image.href.baseVal);
  }
  private isVisible(element: Element, frame: HTMLIFrameElement, viewport: DOMRect) {
    const origin = frame.getBoundingClientRect();
    return Array.from(element.getClientRects()).some(rect => rect.right + origin.left > viewport.left && rect.left + origin.left < viewport.right && rect.bottom + origin.top > viewport.top && rect.top + origin.top < viewport.bottom);
  }
  private isAsset(url: string) { return [...this.urls].some(([key, value]) => !key.startsWith('\u0000') && (url === value.url || url.startsWith(value.url + '#'))); }
  private async decodeURL(url: string) {
    if (!this.isAsset(url)) throw new Error('Visible SVG image has no owned book asset');
    if (!this.decoded.has(url)) this.decoded.set(url, (async () => { const image = new Image(); image.src = url; try { await image.decode(); if (!image.naturalWidth) throw new Error('Visible SVG image not decoded'); } finally { image.removeAttribute('src'); } })());
    await this.decoded.get(url);
  }
  pageState(doc: Document, entry: string, frame: HTMLIFrameElement, viewport: DOMRect) {
    const targets = new Map((this.images.get(entry) || []).map(target => [target.index, target])); let pending = false;
    const state: unknown[] = [];
    for (const [index, image] of Array.from(doc.images).entries()) if (image.hasAttribute('src') && this.isVisible(image, frame, viewport)) {
      const target = targets.get(index), src = image.getAttribute('src') || '';
      const real = this.isAsset(src) && (!target || src !== target.placeholder);
      pending ||= !real || !image.complete || !image.naturalWidth;
      const rect = image.getBoundingClientRect(); state.push([index, src, rect.x, rect.y, rect.width, rect.height]);
    }
    for (const image of doc.querySelectorAll<SVGImageElement>('svg image')) if (image.href.baseVal && this.isVisible(image, frame, viewport)) {
      pending ||= !this.isAsset(image.href.baseVal) || !this.decoded.has(image.href.baseVal);
      const rect = image.getBoundingClientRect(); state.push([image.href.baseVal, rect.x, rect.y, rect.width, rect.height]);
    }
    return { pending, signature: JSON.stringify(state) };
  }
  private releaseOwner(owner: string) { for (const [path, value] of this.urls) { value.owners.delete(owner); if (!value.owners.size) { URL.revokeObjectURL(value.url); for (const key of this.decoded.keys()) if (key === value.url || key.startsWith(value.url + '#')) this.decoded.delete(key); this.stats.assetBytes -= value.bytes; this.urls.delete(path); } } this.stats.urls = this.urls.size; }
  releaseChapter(owner: string) { const owners = new Set<string>(); for (const value of this.urls.values()) for (const key of value.owners) if (key === owner || key.startsWith(`${owner}\u0000`)) owners.add(key); for (const key of owners) this.releaseOwner(key); this.images.delete(owner); }
  dispose() { this.images.clear(); this.decoded.clear(); for (const value of this.urls.values()) URL.revokeObjectURL(value.url); this.urls.clear(); this.clearDocuments(); this.stats.urls = 0; this.stats.assetBytes = 0; }
}
