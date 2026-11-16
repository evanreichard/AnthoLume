import { Book, type NavItem, type Location } from 'epubjs';
import type Rendition from 'epubjs/types/rendition';
import { fromCFI, toCFI, koFromElement } from './codec';
import { validateEPUB } from './content-policy';
import type { ChapterPolicy } from './chapter-policy';
import { serializeChapter } from './body-contract';
import { ScopedViewManager, destroyBook, useValidatedDocuments } from './epub-lifecycle';

export const lifecycle = { created: 0, disposed: 0, engines: 0, destroyed: 0, listeners: 0, contentListeners: 0 };
export type ReaderSnapshot = { ko: string; cfi: string; chapter: string; page: number; pages: number };
export type ReaderStatus = { state: 'opening' | 'ready' | 'error'; message: string; location?: ReaderSnapshot; toc?: { label: string; href: string }[] };

export class ReaderController {
  private dead = false;
  private openRequested = false;
  private book?: Book;
  private policy?: ChapterPolicy;
  private rendition?: Rendition;
  private tail: Promise<unknown> = Promise.resolve();
  private host: HTMLDivElement;
  private location?: ReaderSnapshot;
  private tocTargets = new Map<string, ReturnType<ChapterPolicy['navigation']>>();
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
      this.policy = await validateEPUB(bytes);
      if (this.dead) return;
      const book = this.book = new Book({ replacements: 'none', requestMethod: () => Promise.reject(new Error('Engine network requests are disabled')) });
      lifecycle.engines++;
      await book.open(bytes, 'binary');
      await book.ready;
      if (this.dead) return;
      const navigationPath = book.packaging.navPath || book.packaging.ncxPath;
      if (navigationPath) {
        const base = this.policy.navigationDocument(navigationPath);
        const map = (items: NavItem[]) => {
          for (const item of items) {
            if (item.href) this.tocTargets.set(item.href, this.policy!.navigation(item.href, base));
            map(item.subitems || []);
          }
        };
        map(book.navigation.toc);
      }
      useValidatedDocuments(book, this.policy);
      // Pinned Serialization Seam - Own canonical asset URLs, not EPUB.js's regex substitution of serialized body text.
      book.spine.hooks.serialize.clear();
      book.spine.hooks.serialize.register((_output: string, section: { document: Document; output: string }) => { section.output = serializeChapter(section.document); });
      book.spine.hooks.content.register((doc: Document, section: { index: number }) => this.policy!.prepareChapter(doc, section.index));
      const rendition = this.rendition = book.renderTo(this.host, { width: '100%', height: '100%', spread: 'none', manager: ScopedViewManager, allowScriptedContent: false });
      // Chapter Hooks - Book links cannot trigger native frame navigation or bypass serialized controller commands.
      rendition.hooks.content.register((contents: { document: Document; sectionIndex: number }) => {
        if (this.dead || this.contentCleanup.has(contents.document)) return;
        const blockLink = (event: Event) => {
          const target = event.target as Element;
          const link = target.closest?.('a[href]');
          if (!link) return;
          event.preventDefault(); event.stopImmediatePropagation();
          if (event.type === 'click' && (!('button' in event) || event.button === 0)) void this.internal(link.getAttribute('href')!, this.policy!.spine[contents.sectionIndex]!);
        };
        contents.document.addEventListener('click', blockLink, true);
        contents.document.addEventListener('auxclick', blockLink, true);
        lifecycle.contentListeners += 2;
        this.contentCleanup.set(contents.document, () => {
          contents.document.removeEventListener('click', blockLink, true);
          contents.document.removeEventListener('auxclick', blockLink, true);
          lifecycle.contentListeners -= 2;
        });
        return contents.document.fonts.ready;
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
  private navigate(action: () => Promise<void | { ko: string; cfi: string }>) {
    return this.enqueue(async () => {
      if (!this.rendition || !this.location) throw new Error('Reader not ready; fallback requires explicit reopen');
      const logical = await action();
      if (this.dead) return;
      await this.observe();
      if (this.dead) return;
      if (logical && this.location) this.location = { ...this.location, ...logical };
      await this.publish(this.location!);
      this.ready('Intentional navigation saved');
    });
  }
  next() { return this.navigate(() => this.rendition!.next()); }
  previous() { return this.navigate(() => this.rendition!.prev()); }
  toc(href: string) {
    const target = this.tocTargets.get(href);
    if (!target) return Promise.reject(new Error('TOC target not allowed'));
    return this.navigate(() => this.displayTarget(target));
  }
  private internal(href: string, entry: string) {
    return this.navigate(() => this.displayTarget(this.policy!.navigation(href, entry)));
  }
  private async displayTarget(ref: ReturnType<ChapterPolicy['navigation']>) {
    const section = this.book!.spine.get(ref.index);
    if (!ref.fragment) { await this.rendition!.display(section.href); return; }
    await section.load(this.book!.load.bind(this.book));
    const element = section.document.getElementById(ref.fragment);
    if (!element) throw new Error('Internal fragment unavailable');
    const ko = koFromElement(ref.index, element);
    const result = await toCFI(this.book!, ko);
    if (!result.ok) throw new Error(result.reason);
    await this.rendition!.display(result.cfi);
    return { ko, cfi: result.cfi };
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
    this.tocTargets.clear();
    this.host.remove();
    this.tail = this.tail.finally(() => {
      try {
        if (this.book) { destroyBook(this.book); lifecycle.destroyed++; }
      } finally {
        this.book = undefined; this.rendition = undefined;
        this.policy?.dispose(); this.policy = undefined;
      }
    });
    return this.tail.then(() => undefined);
  }
}
