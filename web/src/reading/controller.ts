import { Book, EpubCFI, type NavItem, type Location } from 'epubjs';
import { measureActivity, type CapturedActivity } from './activity';
import { legacyCFIRange } from './visible-text';
import { ReaderFonts } from './reader-fonts';
import { bindReadingPinch } from './pinch';
import type Rendition from 'epubjs/types/rendition';
import type { RenditionOptions } from 'epubjs/types/rendition';
import type Contents from 'epubjs/types/contents';
import { fromCFI, toCFI, canonicalPosition } from './codec';
import { validateEPUB } from './content-policy';
import { ChapterPolicy } from './chapter-policy';
import { ArchiveReader, blobSource, sourceStats, type Source } from './source';
import type { BookManifest } from './book-manifest';
import { serializeChapter } from './body-contract';
import { ScopedViewManager, destroyBook, settleBookFailures, settleDisplayFailures, useValidatedDocuments } from './epub-lifecycle';

export const lifecycle = { created: 0, disposed: 0, engines: 0, destroyed: 0, listeners: 0, contentListeners: 0 };
export type ReaderSnapshot = { ko: string; cfi: string; chapter: string; page: number; pages: number; fraction: number };
export type { CapturedActivity } from './activity';
export type Appearance = { size: number; font: string; theme: 'light' | 'tan' | 'blue' | 'gray' | 'black' };
export const palette = { light: ['#ffffff', '#202020'], tan: ['#f3ead5', '#392e21'], blue: ['#dce7ef', '#203747'], gray: ['#35383d', '#eeeeee'], black: ['#121212', '#dddddd'] } as const;
export type ReaderStatus = { state: 'opening' | 'ready' | 'error'; message: string; location?: ReaderSnapshot; canGoBack?: boolean; toc?: { label: string; href: string }[]; diagnostics?: ReturnType<ReaderController['diagnostics']> };

export class ReaderController {
  private dead = false;
  private lifetime = new AbortController();
  private removeAbort?: () => void;
  private removeDisplayFailure?: () => void;
  private openRequested = false;
  private book?: Book;
  private policy?: ChapterPolicy;
  private rendition?: Rendition;
  private tail: Promise<unknown> = Promise.resolve();
  private host: HTMLDivElement;
  private location?: ReaderSnapshot;
  private jumpHistory: Pick<ReaderSnapshot, 'ko' | 'cfi'>[] = [];
  private wordCounts: number[] = [];
  private readerFonts = new ReaderFonts();
  private pageStart = 0;
  private pendingActivity?: CapturedActivity;
  private appearance: Appearance = { size: 100, font: 'serif', theme: 'tan' };
  private readyToInteract = false;
  private reportedCSSDrops = false;
  private viewportSize?: { width: number; height: number };
  private tocTargets = new Map<string, ReturnType<ChapterPolicy['navigation']>>();
  private contentCleanup = new Map<Document, () => void>();
  private passiveLinks = new WeakMap<Element, string>();
  private key = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || document.querySelector('dialog:modal')) return;
    if (event.key === 'ArrowRight') void this.next();
    if (event.key === 'ArrowLeft') void this.previous();
    if (event.key.toLowerCase() === 't') this.options.cycleTheme?.();
    if (event.key.toLowerCase() === 'c' && !event.altKey && !event.ctrlKey && !event.metaKey) this.options.chrome?.('focus');
    if (event.key === 'Escape') this.options.chrome?.('hide');
  };
  constructor(host: HTMLElement, private status: (value: ReaderStatus) => void, private publish: (location: ReaderSnapshot, activity?: CapturedActivity) => Promise<void>, private options: { localOnly?: boolean; parentGestures?: boolean; resizeText?: (scale: number, finished: boolean) => void; credit?: (activity: CapturedActivity) => Promise<void>; cycleTheme?: () => void; interact?: () => void; chrome?: (action: 'show' | 'toggle' | 'focus' | 'hide') => void } = {}) {
    this.lifetime.signal.addEventListener('abort', () => this.readerFonts.dispose(), { once: true });
    this.host = document.createElement('div');
    this.host.style.height = '100%';
    host.appendChild(this.host);
    window.addEventListener('keydown', this.key);
    lifecycle.listeners++; lifecycle.created++;
  }
  private send(value: ReaderStatus) { if (!this.dead) this.status({ ...value, canGoBack: this.jumpHistory.length > 0 }); }
  private enqueue(action: () => Promise<void>): Promise<void> {
    const result = this.tail.then(async () => {
      if (this.dead) return;
      try { await action(); } finally { this.releaseInactive(); }
    });
    this.tail = result.catch(error => { this.readyToInteract = false; this.send({ state: 'error', message: String(error), location: this.location, toc: this.tocItems(), diagnostics: this.diagnostics() }); });
    return this.tail as Promise<void>;
  }
  open(input: Source | Blob | ArrayBuffer, saved?: string, signal?: AbortSignal, manifest?: BookManifest, appearance?: Appearance) {
    if (this.dead || this.openRequested) return Promise.reject(new Error('Controller open is single-use; create a new controller'));
    this.openRequested = true;
    if (appearance) this.appearance = appearance;
    const abort = () => this.lifetime.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true }); this.removeAbort = () => signal?.removeEventListener('abort', abort); if (signal?.aborted) abort();
    return this.enqueue(async () => {
      const opening = (message: string) => this.send({ state: 'opening', message });
      const source = input instanceof Blob ? blobSource(input) : input instanceof ArrayBuffer ? blobSource(new Blob([input])) : input;
      this.policy = manifest ? new ChapterPolicy(new ArchiveReader(source, manifest.index, this.lifetime.signal), manifest) : await validateEPUB(source, this.lifetime.signal, false, opening);
      const { manifest: bookManifest, reader } = this.policy;
      this.wordCounts = this.policy.spine.map(path => bookManifest.lazy ? Math.max(1, Math.round(reader.byName.get(path)!.expanded / 8)) : bookManifest.documents[path]!.words);
      if (this.dead) return;
      const book = this.book = new Book({ replacements: 'none', requestMethod: () => Promise.reject(new Error('Engine network requests are disabled')) });
      lifecycle.engines++; settleBookFailures(book);
      useValidatedDocuments(book, this.policy);
      opening('Loading the table of contents…');
      await book.open(`https://epub.invalid/${this.policy.opf}`, 'opf');
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
      // Chapter Head Ownership - EPUB.js inserts its own base and canonical URL, which are outside the validated archive resource policy.
      book.spine.hooks.content.clear();
      book.spine.hooks.content.register((doc: Document, section: { index: number }) => this.policy!.prepareChapter(doc, section.index));
      const options: RenditionOptions & { method: 'blobUrl' } = { width: '100%', height: '100%', flow: 'paginated', method: 'blobUrl', spread: 'none', manager: ScopedViewManager, allowScriptedContent: false };
      const rendition = this.rendition = book.renderTo(this.host, options);
      this.removeDisplayFailure = settleDisplayFailures(rendition, this.lifetime.signal);
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
        // WebKit suppresses parent-installed callbacks in scriptless frames. Neutralize native link navigation even when the gesture layer is off for selection.
        if (this.options.parentGestures) {
          for (const link of contents.document.querySelectorAll('a[href]')) {
            this.passiveLinks.set(link, link.getAttribute('href')!);
            link.removeAttribute('href');
          }
        }
        const gestureCleanup = this.options.parentGestures ? undefined : this.bindGestures(contents.document);
        this.readerFonts.install(contents.document);
        this.applyAppearance();
        lifecycle.contentListeners += 2;
        this.contentCleanup.set(contents.document, () => {
          gestureCleanup?.();
          contents.document.removeEventListener('click', blockLink, true);
          contents.document.removeEventListener('auxclick', blockLink, true);
          lifecycle.contentListeners -= 2;
        });
        return Promise.all([contents.document.fonts.ready, ...Array.from(contents.document.images).filter(image => image.hasAttribute('src')).map(image => image.decode())]);
      });
      let target: string | undefined;
      if (saved) {
        opening('Finding your saved page…');
        const result = await toCFI(book, saved);
        if (!result.ok) {
          const message = result.phase === 'chapter' ? `Could not load the saved chapter: ${result.reason}` : `Saved location unavailable; original retained: ${saved}`;
          this.send({ state: 'error', message });
          return;
        }
        target = result.cfi;
      }
      opening('Loading the page…');
      await this.waitEngine(rendition.display(target), 'displaying the opening chapter');
      if (this.dead) return;
      opening('Laying out the page…');
      await this.observe(target);
      if (saved && target && this.location) this.location = { ...this.location, ko: saved, cfi: target };
      this.readyToInteract = true;
      this.pageStart = Date.now();
      this.ready('Ready — element-level restoration does not publish progress');
    });
  }
  private tocItems() {
    const flatten = (items: NavItem[]): { label: string; href: string }[] => items.flatMap(item => [{ label: item.label.trim(), href: item.href }, ...flatten(item.subitems || [])]);
    return flatten(this.book?.navigation?.toc || []);
  }
  private ready(message: string) {
    const cssDrops = this.policy?.manifest.cssDrops;
    if (!this.reportedCSSDrops && cssDrops && Object.keys(cssDrops).length) {
      this.reportedCSSDrops = true;
      console.warn('[AnthoLume reader] Skipped optional EPUB resources or styling', { ...cssDrops });
    }
    this.readyToInteract = true;
    this.releaseInactive();
    this.send({ state: 'ready', message, location: this.location, toc: this.tocItems(), diagnostics: this.diagnostics() });
  }
  private async observe(target?: string, firstContent = false) {
    const visual = await this.settleLayout(target, firstContent);
    if (this.dead) return;
    const loc = this.rendition!.location as Location;
    if (!loc?.start?.cfi) throw new Error('Engine location unavailable');
    const ko = await fromCFI(this.book!, visual || loc.start.cfi);
    if (this.dead) return;
    const { currentWord, totalWords } = await this.wordPosition(visual);
    this.location = { ko, cfi: visual || loc.start.cfi, chapter: loc.start.href, page: loc.start.displayed.page, pages: loc.start.displayed.total, fraction: Math.round(currentWord / totalWords * 100000) / 100000 };
    this.releaseInactive();
  }
  private navigate(action: () => Promise<void | { ko?: string; cfi: string; firstContent?: boolean }>, mode: 'page' | 'forward' | 'jump' | 'back' = 'page') {
    return this.enqueue(async () => {
      if (mode === 'back' && !this.jumpHistory.length) return;
      if (!this.rendition || !this.location) throw new Error('Reader not ready; fallback requires explicit reopen');
      const activity = mode === 'forward' ? await this.captureActivity() : undefined;
      if (activity && this.options.credit) {
        await this.options.credit(activity);
        // Interval Consumption - A committed credit survives engine/checkpoint failure; it is not available for another event.
        this.pageStart = activity.endMs;
        this.pendingActivity = undefined;
      }
      this.options.interact?.();
      this.readyToInteract = false;
      this.send({ state: 'opening', message: 'Updating book layout', location: this.location, toc: this.tocItems() });
      await this.waitEngine(this.nextPaint());
      const previous = this.location, beforeFrame = this.host.querySelector('iframe'), beforeBox = beforeFrame?.getBoundingClientRect();
      let logical: void | { ko?: string; cfi: string; firstContent?: boolean };
      try {
        logical = await action();
        if (this.dead) return;
        await this.observe(logical?.cfi, logical?.firstContent);
      } catch (error) {
        if (!this.dead && !this.lifetime.signal.aborted && previous) {
          const frame = this.host.querySelector('iframe'), box = frame?.getBoundingClientRect();
          if (frame !== beforeFrame || box?.left !== beforeBox?.left || box?.top !== beforeBox?.top) { await this.waitEngine(this.rendition!.display(previous.cfi)); await this.settleLayout(previous.cfi); }
          this.location = previous;
        }
        throw error;
      }
      if (this.dead) return;
      if (logical?.ko && this.location) this.location = { ...this.location, ko: logical.ko, cfi: logical.cfi };
      await this.publish(this.location!, this.options.credit ? undefined : activity);
      if (mode === 'back') this.jumpHistory.pop();
      else if (mode === 'jump' && previous.ko !== this.location!.ko) {
        this.jumpHistory.push({ ko: previous.ko, cfi: previous.cfi });
        if (this.jumpHistory.length > 50) this.jumpHistory.shift();
        this.options.chrome?.('show');
      }
      this.pageStart = Date.now();
      this.pendingActivity = undefined;
      this.ready('Intentional navigation saved');
    });
  }
  next() { return this.navigate(() => this.rendition!.next(), 'forward'); }
  previous() { return this.navigate(() => this.rendition!.prev()); }
  back() {
    return this.navigate(async () => {
      const target = this.jumpHistory.at(-1)!;
      await this.waitEngine(this.rendition!.display(target.cfi));
      return target;
    }, 'back');
  }
  toc(href: string) {
    const target = this.tocTargets.get(href);
    if (!target) return Promise.reject(new Error('TOC target not allowed'));
    return this.navigate(() => this.displayTarget(target), 'jump');
  }
  tapLinkAt(x: number, y: number): boolean {
    this.options.interact?.();
    if (!this.readyToInteract || !this.rendition || !this.policy) return false;
    for (const contents of this.rendition.getContents() as unknown as Array<Contents & { sectionIndex: number }>) {
      const frame = Array.from(this.host.querySelectorAll('iframe')).find(candidate => candidate.contentDocument === contents.document);
      const box = frame?.getBoundingClientRect();
      if (!box || x < box.left || x >= box.right || y < box.top || y >= box.bottom) continue;
      const link = contents.document.elementFromPoint(x - box.left, y - box.top)?.closest('a');
      const href = link && this.passiveLinks.get(link);
      if (href === undefined || href === null) continue;
      if (!href.startsWith('#antholume-unavailable-')) void this.internal(href, this.policy.spine[contents.sectionIndex]!);
      return true;
    }
    return false;
  }
  private internal(href: string, entry: string) {
    return this.navigate(() => this.displayTarget(this.policy!.navigation(href, entry)), 'jump');
  }
  private async displayTarget(ref: ReturnType<ChapterPolicy['navigation']>) {
    const section = this.book!.spine.get(ref.index);
    await section.load(this.book!.load.bind(this.book));
    const element = ref.fragment ? section.document.getElementById(ref.fragment) : section.document.querySelector('body');
    if (!element) throw new Error('Internal fragment unavailable');
    const result = await canonicalPosition(this.book!, ref.index, element);
    await this.waitEngine(this.rendition!.display(result.cfi));
    return ref.fragment ? result : { cfi: result.cfi, firstContent: true };
  }
  reflow(size: number, font = this.appearance.font, theme = this.appearance.theme) {
    return this.enqueue(async () => {
      if (!this.readyToInteract) return;
      if (!this.location || !this.rendition) throw new Error('No anchor to reflow');
      const anchor = this.location;
      this.readyToInteract = false;
      this.send({ state: 'opening', message: 'Applying appearance', location: anchor, toc: this.tocItems() });
      await this.waitEngine(this.nextPaint());
      await this.waitEngine(this.readerFonts.load(font));
      if (this.dead) return;
      this.appearance = { size, font, theme };
      const documents = this.rendition.getContents() as unknown as Contents[];
      for (const contents of documents) this.readerFonts.install(contents.document);
      this.applyAppearance();
      await this.waitEngine(Promise.all(documents.map(contents => contents.document.fonts.load(`16px "${font}"`))));
      await this.waitEngine(this.rendition.display(anchor.cfi));
      await this.observe(anchor.cfi);
      // Resume Precision - Reflow preserves the logical anchor, not the new page's first visible word.
      this.location = { ...this.location!, ko: anchor.ko, cfi: anchor.cfi, fraction: anchor.fraction, chapter: anchor.chapter };
      this.ready('Reflow retained logical anchor; no progress published');
    });
  }
  private waitEngine<T>(operation: PromiseLike<T>, phase = 'settling the book layout') {
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = (error?: unknown, value?: T) => { if (finished) return; finished = true; clearTimeout(timer); this.lifetime.signal.removeEventListener('abort', abort); if (error) reject(error); else resolve(value!); };
      const abort = () => finish(this.lifetime.signal.reason);
      const timer = setTimeout(() => this.lifetime.abort(new Error(`Reader timed out while ${phase}`)), 15000);
      this.lifetime.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(operation).then(value => finish(undefined, value), error => finish(error));
      if (this.lifetime.signal.aborted) abort();
    });
  }
  private anchorVisible(cfi: string) {
    const viewport = this.host.getBoundingClientRect();
    for (const contents of (this.rendition!.getContents() || []) as unknown as Contents[]) {
      const frame = Array.from(this.host.querySelectorAll('iframe')).find(f => f.contentDocument === contents.document);
      if (!frame || (contents as Contents & { sectionIndex: number }).sectionIndex !== new EpubCFI(cfi).spinePos) continue;
      const range = new EpubCFI(cfi).toRange(contents.document), node = range.startContainer;
      const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
      const origin = frame.getBoundingClientRect();
      if (element && Array.from(element.getClientRects()).some(r => r.right + origin.left >= viewport.left && r.left + origin.left < viewport.right && r.bottom + origin.top > viewport.top && r.top + origin.top < viewport.bottom)) return true;
    }
    return false;
  }
  private visiblePageCFI() {
    const viewport = this.host.getBoundingClientRect();
    for (const contents of (this.rendition!.getContents() || []) as unknown as Contents[]) {
      const doc = contents.document, frame = doc.defaultView?.frameElement;
      if (!frame) continue;
      const origin = frame.getBoundingClientRect();
      // Paginated Columns - EPUB.js can report the next chapter heading while a preceding paragraph still fills the viewport.
      const nodes = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
      for (let node = nodes.nextNode(); node; node = nodes.nextNode()) {
        for (const rect of (node as Element).getClientRects()) {
          const left = Math.max(rect.left, viewport.left - origin.left), right = Math.min(rect.right, viewport.right - origin.left);
          const top = Math.max(rect.top, viewport.top - origin.top), bottom = Math.min(rect.bottom, viewport.bottom - origin.top);
          if (right <= left || bottom <= top) continue;
          const x = (left + right) / 2, y = (top + bottom) / 2;
          const hit = doc.elementFromPoint(x, y);
          if (!hit || hit === doc.body || !doc.body.contains(hit)) continue;
          const caret = doc.caretPositionFromPoint?.(x, y);
          if (!caret || !hit.contains(caret.offsetNode)) return contents.cfiFromNode(hit);
          const range = doc.createRange(); range.setStart(caret.offsetNode, caret.offset); range.collapse(true);
          return contents.cfiFromRange(range);
        }
      }
    }
  }
  private async settleLayout(target?: string, firstContent = false): Promise<string> {
    const rendition = this.rendition!;
    // Native Resize - EPUB.js restores rendition.location on resize, but reportLocation resolves before publishing it.
    await this.waitEngine(rendition.reportLocation());
    await this.waitEngine(this.nextPaint());
    let last = '';
    for (let pass = 0; pass < 8; pass++) {
      this.lifetime.signal.throwIfAborted();
      // Stage Precision - Match EPUB.js's integer client dimensions so fractional bounds cannot repeatedly clear its views.
      const width = this.host.clientWidth, height = this.host.clientHeight;
      if (this.viewportSize?.width !== width || this.viewportSize.height !== height) {
        rendition.resize(width, height);
        this.viewportSize = { width, height };
        await this.waitEngine(rendition.q.enqueue(() => undefined));
      }
      const contents = (rendition.getContents() || []) as unknown as Contents[];
      await this.waitEngine(Promise.all(contents.map(async c => { await c.document.fonts.load(`16px "${this.appearance.font}"`); await c.document.fonts.ready; })));
      if (target) await this.waitEngine(rendition.display(target));
      await this.waitEngine(this.materializeVisible());
      const manager = (rendition as unknown as { manager: { views: { all(): { expand(): void }[] } } }).manager;
      for (const view of manager.views.all()) view.expand();
      await this.waitEngine(this.nextPaint()); await this.waitEngine(rendition.reportLocation());
      await this.waitEngine(this.nextPaint());
      let pending = false; const signatures: string[] = [];
      for (const c of (rendition.getContents() || []) as unknown as Contents[]) {
        const frame = Array.from(this.host.querySelectorAll('iframe')).find(f => f.contentDocument === c.document);
        if (!frame) { pending = true; continue; }
        const state = this.policy!.pageState(c.document, this.policy!.spine[(c as Contents & { sectionIndex: number }).sectionIndex]!, frame, this.host.getBoundingClientRect());
        pending ||= state.pending; signatures.push(state.signature);
      }
      // Native Location - reportLocation resolves before its animation-frame update; the pinned engine's currentLocation type omits the wrapper.
      const loc = await this.waitEngine(Promise.resolve(rendition.currentLocation())) as unknown as Location;
      rendition.location = loc;
      const visual = target && !firstContent ? target : loc?.start?.cfi;
      const signature = JSON.stringify([loc?.start?.cfi, loc?.start?.displayed, this.host.clientWidth, this.host.clientHeight, signatures]);
      if (!pending && visual && signatures.length && signature === last) {
        if (this.anchorVisible(visual)) return visual;
        if (!target || firstContent) {
          const visible = this.visiblePageCFI();
          if (visible && this.anchorVisible(visible)) return visible;
        }
      }
      last = !pending ? signature : '';
    }
    throw new Error('Book layout/visible assets or requested anchor did not stabilize');
  }
  private nextPaint() {
    return new Promise<void>((resolve, reject) => {
      let frame = 0;
      const done = () => { this.lifetime.signal.removeEventListener('abort', abort); resolve(); };
      const abort = () => { cancelAnimationFrame(frame); this.lifetime.signal.removeEventListener('abort', abort); reject(this.lifetime.signal.reason); };
      this.lifetime.signal.addEventListener('abort', abort, { once: true });
      if (this.lifetime.signal.aborted) abort(); else frame = requestAnimationFrame(() => { frame = requestAnimationFrame(done); });
    });
  }
  private async materializeVisible() {
    if (!this.rendition || !this.policy || this.dead) return;
    for (const contents of this.rendition.getContents() as unknown as Contents[]) {
      const frame = Array.from(this.host.querySelectorAll('iframe')).find(f => f.contentDocument === contents.document);
      if (frame) await this.policy.loadVisible(contents.document, this.policy.spine[(contents as Contents & { sectionIndex: number }).sectionIndex]!, frame, this.host.getBoundingClientRect());
    }
  }
  private releaseInactive() {
    if (!this.rendition || !this.book || !this.policy) return;
    const contents = (this.rendition.getContents() || []) as unknown as Contents[];
    const live = new Set(contents.map(c => c.document)), indexes = new Set(contents.map(c => (c as Contents & { sectionIndex: number }).sectionIndex));
    for (const [doc, cleanup] of this.contentCleanup) if (!live.has(doc)) { cleanup(); this.contentCleanup.delete(doc); }
    this.book.spine.each((section: import('epubjs/types/section').default) => { if (!indexes.has(section.index)) { (section as typeof section & { unload(): void }).unload(); this.policy!.releaseChapter(this.policy!.spine[section.index]!); } });
  }
  diagnostics() {
    let loadedSections = 0; this.book?.spine.each((section: import('epubjs/types/section').default) => { if (section.document) loadedSections++; });
    return { source: { ...sourceStats }, cache: this.policy ? { ...this.policy.stats } : null, loadedSections, contentDocuments: this.contentCleanup.size };
  }
  private words(text: string) { return text.trim().split(/\s+/).length; }
  private async wordPosition(cfi: string) {
    const range = await this.book!.getRange(cfi);
    const body = range.startContainer.ownerDocument!.querySelector('body')!;
    const before = body.ownerDocument.createRange(); before.selectNodeContents(body); before.setEnd(range.startContainer, range.startOffset);
    const index = new EpubCFI(cfi).spinePos;
    const textBefore = before.toString();
    const wordsBefore = this.policy!.manifest.lazy && !textBefore.trim() ? 0 : this.words(textBefore);
    // Stable Chapter Weights - Visiting another chapter must not change the percentage of a previously visited anchor.
    const within = this.policy!.manifest.lazy ? this.wordCounts[index]! * Math.min(1, wordsBefore / this.words(body.textContent || '')) : wordsBefore;
    return { currentWord: this.wordCounts.slice(0, index).reduce((a, b) => a + b, 0) + within, totalWords: this.wordCounts.reduce((a, b) => a + b, 0) };
  }
  private async captureActivity() {
    if (this.options.localOnly) return;
    if (this.pendingActivity) return this.pendingActivity;
    const location = this.rendition!.location as Location;
    const visible = await this.book!.getRange(legacyCFIRange(location.start.cfi, location.end.cfi));
    if (!visible) throw new Error('Visible text range unavailable; no activity or progress was saved');
    const text = visible.toString().trim();
    if (!text) return;
    const position = await this.wordPosition(this.location?.cfi ?? location.start.cfi);
    const endMs = Date.now();
    const measured = measureActivity({ ...position, forward: true, localOnly: !!this.options.localOnly, pageWords: this.words(text), pageStartMs: this.pageStart, nowMs: endMs });
    if (measured) this.pendingActivity = { ...measured, intervalId: crypto.randomUUID(), startMs: this.pageStart, endMs };
    return this.pendingActivity;
  }
  private applyAppearance() {
    if (!this.rendition) return;
    const { size, font, theme } = this.appearance, [background, color] = palette[theme];
    this.rendition.themes.default({ body: { background: `${background} !important`, color: `${color} !important`, 'font-family': `${font} !important`, 'font-size': `${size}% !important` } });
  }
  private bindGestures(doc: Document) {
    type Contact = { id: number; x: number; y: number; at: number };
    let touchStart: Contact | undefined, pointerStart: Contact | undefined, lastTouch = 0, hoveringCenter = false;
    const frame = Array.from(this.host.querySelectorAll('iframe')).find(candidate => candidate.contentDocument === doc);
    const surface = doc.documentElement as HTMLElement;
    const resizeText = this.options.resizeText;
    if (resizeText) surface.style.touchAction = 'none';
    const interactive = (event: Event) => event.defaultPrevented || (event.target as Element | null)?.closest?.('a[href], button, input, select, textarea') || doc.getSelection()?.isCollapsed === false;
    const point = (clientX: number, clientY: number) => {
      const viewport = this.host.getBoundingClientRect(), origin = frame?.getBoundingClientRect();
      return { x: (clientX + (origin?.left ?? viewport.left) - viewport.left) / viewport.width,
        y: (clientY + (origin?.top ?? viewport.top) - viewport.top) / viewport.height };
    };
    const centered = (x: number, y: number) => x >= .2 && x <= .8 && y >= .18 && y <= .82;
    const tap = (clientX: number, clientY: number) => {
      if (!this.readyToInteract) return;
      this.options.interact?.();
      const { x, y } = point(clientX, clientY);
      if (centered(x, y)) this.options.chrome?.('toggle');
      else if (y >= .18 && y <= .82 && x < .2) void this.previous();
      else if (y >= .18 && y <= .82 && x > .8) void this.next();
    };
    const click = (event: MouseEvent) => {
      if (Date.now() - lastTouch < 500 || interactive(event)) return;
      tap(event.clientX, event.clientY);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const { x, y } = point(event.clientX, event.clientY), inCenter = centered(x, y);
      if (inCenter && !hoveringCenter && !event.buttons && this.readyToInteract && !interactive(event)) this.options.chrome?.('show');
      hoveringCenter = inCenter;
    };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) hoveringCenter = false; };
    const contact = (id: number, x: number, y: number): Contact => ({ id, x, y, at: Date.now() });
    const cancel = () => { touchStart = pointerStart = undefined; };
    const finish = (start: Contact, clientX: number, clientY: number, event: Event) => {
      // One Gesture, Two Event Streams - A physical tap may emit pointerup, touchend, then a compatibility click.
      cancel();
      lastTouch = Date.now();
      if (!this.readyToInteract || interactive(event)) return;
      const dx = clientX - start.x, dy = clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 14 && lastTouch - start.at < 500) tap(clientX, clientY);
      else if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) void this.next();
        else void this.previous();
      } else if (Math.abs(dy) >= 60 && Math.abs(dy) > Math.abs(dx)) this.options.chrome?.('show');
    };
    const down = (event: TouchEvent) => {
      if (event.touches.length > 1) { cancel(); return; }
      const touch = event.changedTouches[0];
      if (!touch || interactive(event)) return;
      touchStart = contact(touch.identifier, touch.clientX, touch.clientY);
      this.options.interact?.();
    };
    const up = (event: TouchEvent) => {
      const touch = Array.from(event.changedTouches).find(candidate => candidate.identifier === touchStart?.id);
      if (touch && touchStart) finish(touchStart, touch.clientX, touch.clientY, event);
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      if (!event.isPrimary) { cancel(); return; }
      if (interactive(event)) return;
      pointerStart = contact(event.pointerId, event.clientX, event.clientY);
    };
    const pointerUp = (event: PointerEvent) => {
      if (pointerStart?.id === event.pointerId) finish(pointerStart, event.clientX, event.clientY, event);
    };
    const pointerCancel = () => { pointerStart = undefined; };
    const listeners = new AbortController(), capture = { capture: true, signal: listeners.signal };
    doc.addEventListener('click', click, capture);
    doc.addEventListener('pointermove', move, capture); doc.addEventListener('pointerout', leave, capture);
    doc.addEventListener('pointerdown', pointerDown, capture); doc.addEventListener('pointerup', pointerUp, capture); doc.addEventListener('pointercancel', pointerCancel, capture);
    doc.addEventListener('touchstart', down, { ...capture, passive: true }); doc.addEventListener('touchend', up, { ...capture, passive: true }); doc.addEventListener('touchcancel', cancel, capture);
    doc.addEventListener('keydown', this.key, capture);
    const unbindPinch = resizeText && bindReadingPinch(surface, (scale, finished) => { cancel(); resizeText(scale, finished); });
    const count = unbindPinch ? 14 : 10;
    lifecycle.contentListeners += count;
    return () => { unbindPinch?.(); listeners.abort(); lifecycle.contentListeners -= count; };
  }
  dispose(): Promise<void> {
    if (this.dead) return this.tail.then(() => undefined);
    this.dead = true; this.lifetime.abort(); this.removeAbort?.();
    lifecycle.disposed++;
    window.removeEventListener('keydown', this.key); lifecycle.listeners--;
    for (const cleanup of this.contentCleanup.values()) cleanup();
    this.contentCleanup.clear();
    this.tocTargets.clear();
    this.host.remove();
    this.readerFonts.dispose();
    this.tail = this.tail.finally(() => {
      try {
        if (this.book) { destroyBook(this.book); lifecycle.destroyed++; }
      } finally {
        this.removeDisplayFailure?.();
        this.book = undefined; this.rendition = undefined;
        this.policy?.dispose(); this.policy = undefined;
      }
    });
    return this.tail.then(() => undefined);
  }
}
