import { Book, type NavItem, type Location } from 'epubjs';
import type Rendition from 'epubjs/types/rendition';
import { fromCFI, toCFI } from './codec';
import { secureChapter, validateEPUB } from './content-policy';
import { ScopedViewManager, destroyBook } from './epub-lifecycle';

export const lifecycle = { created: 0, disposed: 0, engines: 0, destroyed: 0, listeners: 0, contentListeners: 0 };
export type ReaderSnapshot = { ko: string; cfi: string; chapter: string; page: number; pages: number };
export type ReaderStatus = { state: 'opening' | 'ready' | 'error'; message: string; location?: ReaderSnapshot; toc?: { label: string; href: string }[] };

export class ReaderController {
  private dead = false;
  private openRequested = false;
  private book?: Book;
  private rendition?: Rendition;
  private tail: Promise<unknown> = Promise.resolve();
  private host: HTMLDivElement;
  private location?: ReaderSnapshot;
  private contentCleanup = new Map<Document, () => void>();
  private key = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key === 'ArrowRight') void this.next();
    if (event.key === 'ArrowLeft') void this.previous();
  };
  constructor(host: HTMLElement, private status: (value: ReaderStatus) => void, private publish: (location: ReaderSnapshot) => Promise<void>) {
    this.host = document.createElement('div');
    this.host.style.height = '100%';
    host.appendChild(this.host);
    window.addEventListener('keydown', this.key);
    lifecycle.listeners++; lifecycle.created++;
  }
  private send(value: ReaderStatus) { if (!this.dead) this.status(value); }
  private enqueue(action: () => Promise<void>): Promise<void> {
    const result = this.tail.then(async () => { if (!this.dead) await action(); });
    this.tail = result.catch(error => this.send({ state: 'error', message: String(error), location: this.location }));
    return this.tail as Promise<void>;
  }
  open(bytes: ArrayBuffer, saved?: string) {
    if (this.dead || this.openRequested) return Promise.reject(new Error('Controller open is single-use; create a new controller'));
    this.openRequested = true;
    return this.enqueue(async () => {
      this.send({ state: 'opening', message: 'Validating EPUB' });
      await validateEPUB(bytes);
      if (this.dead) return;
      const book = this.book = new Book({ replacements: 'blobUrl' });
      lifecycle.engines++;
      await book.open(bytes, 'binary');
      await book.ready;
      if (this.dead) return;
      book.spine.hooks.content.register(secureChapter);
      const rendition = this.rendition = book.renderTo(this.host, { width: '100%', height: '100%', spread: 'none', manager: ScopedViewManager, allowScriptedContent: false });
      // Chapter Hooks - Capture navigation before EPUB.js link handlers; only controller TOC commands navigate.
      rendition.hooks.content.register((contents: { document: Document }) => {
        if (this.dead || this.contentCleanup.has(contents.document)) return;
        const blockLink = (event: Event) => {
          const target = event.target as Element;
          if (target.closest?.('a')) { event.preventDefault(); event.stopImmediatePropagation(); }
        };
        contents.document.addEventListener('click', blockLink, true);
        lifecycle.contentListeners++;
        this.contentCleanup.set(contents.document, () => {
          contents.document.removeEventListener('click', blockLink, true);
          lifecycle.contentListeners--;
        });
      });
      let target: string | undefined;
      if (saved) {
        const result = await toCFI(book, saved);
        if (!result.ok) {
          this.send({ state: 'error', message: `Saved location unavailable; original retained: ${saved}` });
          return;
        }
        target = result.cfi;
      }
      await rendition.display(target);
      if (this.dead) return;
      await this.observe();
      if (saved && target && this.location) this.location = { ...this.location, ko: saved, cfi: target };
      this.ready('Ready — element-level restoration does not publish progress');
    });
  }
  private ready(message: string) {
    const flatten = (items: NavItem[]): { label: string; href: string }[] => items.flatMap(item => [{ label: item.label.trim(), href: item.href }, ...flatten(item.subitems || [])]);
    this.send({ state: 'ready', message, location: this.location, toc: flatten(this.book?.navigation.toc || []) });
  }
  private async observe() {
    await this.rendition!.reportLocation();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    if (this.dead) return;
    const loc = this.rendition!.location as Location;
    if (!loc?.start?.cfi) throw new Error('Engine location unavailable');
    const ko = await fromCFI(this.book!, loc.start.cfi);
    if (this.dead) return;
    this.location = { ko, cfi: loc.start.cfi, chapter: loc.start.href, page: loc.start.displayed.page, pages: loc.start.displayed.total };
  }
  private navigate(action: () => Promise<void>) {
    return this.enqueue(async () => {
      if (!this.rendition || !this.location) throw new Error('Reader not ready; fallback requires explicit reopen');
      await action();
      if (this.dead) return;
      await this.observe();
      if (this.dead) return;
      await this.publish(this.location!);
      this.ready('Intentional navigation saved');
    });
  }
  next() { return this.navigate(() => this.rendition!.next()); }
  previous() { return this.navigate(() => this.rendition!.prev()); }
  toc(href: string) {
    const allowed = (items: NavItem[]): boolean => items.some(item => item.href === href || allowed(item.subitems || []));
    if (!this.book || !allowed(this.book.navigation.toc)) return Promise.reject(new Error('TOC target not allowed'));
    return this.navigate(() => this.rendition!.display(href));
  }
  reflow(size: number) {
    return this.enqueue(async () => {
      if (!this.location || !this.rendition) throw new Error('No anchor to reflow');
      const anchor = this.location;
      this.rendition.themes.fontSize(`${size}%`);
      const result = await toCFI(this.book!, anchor.ko);
      if (!result.ok) throw new Error(result.reason);
      await this.rendition.display(result.cfi);
      await this.observe();
      // Resume Precision - Reflow preserves the logical anchor, not the new page's first visible word.
      this.location = anchor;
      this.ready('Reflow retained logical anchor; no progress published');
    });
  }
  dispose(): Promise<void> {
    if (this.dead) return this.tail.then(() => undefined);
    this.dead = true;
    lifecycle.disposed++;
    window.removeEventListener('keydown', this.key); lifecycle.listeners--;
    for (const cleanup of this.contentCleanup.values()) cleanup();
    this.contentCleanup.clear();
    this.host.remove();
    this.tail = this.tail.finally(() => {
      if (this.book) {
        destroyBook(this.book); lifecycle.destroyed++;
        this.book = undefined; this.rendition = undefined;
      }
    });
    return this.tail.then(() => undefined);
  }
}
