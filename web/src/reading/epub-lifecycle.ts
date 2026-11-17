import DefaultViewManager from 'epubjs/src/managers/default/index.js';
import type Book from 'epubjs/types/book';
import type Rendition from 'epubjs/types/rendition';
import type { ChapterPolicy } from './chapter-policy';

// Pinned Engine Seam - 0.3.93 installs an anonymous window unload callback that its destroy never removes.
export class ScopedViewManager extends DefaultViewManager {
  override addEventListeners() {
    const scroller = this.settings.fullsize ? window : this.container;
    this._onScroll = this.onScroll.bind(this);
    scroller.addEventListener('scroll', this._onScroll);
  }
  override destroy() {
    // Event Spelling - Stage.destroy removes orientationChange, but Stage registered orientationchange.
    window.removeEventListener('orientationchange', this.stage.orientationChangeFunc);
    super.destroy();
  }
}

export function useValidatedDocuments(book: Book, policy: ChapterPolicy) {
  // Declared XHTML Role - EPUB.js otherwise parses .html as HTML, repairing the original XML tree before content hooks run.
  book.load = (input: string) => {
    const path = decodeURIComponent(new URL(book.resolve(input), 'https://epub.invalid/').pathname).replace(/^\//, '');
    if (!policy.manifest.documents[path]) return Promise.reject(new Error('Unvalidated engine document request'));
    return policy.document(path).then(doc => doc.cloneNode(true));
  };
}

// Pinned Error Delivery - 0.3.93 otherwise leaves ready/display promises unresolved after rejected NAV/chapter work.
export function settleBookFailures(book: Book) {
  const engine = book as unknown as { loadNavigation(packaging: unknown): Promise<unknown>; loading: { navigation: { reject(error: unknown): void } } };
  const load = engine.loadNavigation.bind(engine);
  engine.loadNavigation = packaging => load(packaging).catch(error => { engine.loading.navigation.reject(error); });
}
export function settleDisplayFailures(rendition: Rendition, signal: AbortSignal) {
  const engine = rendition as Rendition & { displaying?: { reject(error: unknown): void } };
  const fail = (error: unknown) => engine.displaying?.reject(error), abort = () => fail(signal.reason);
  engine.on('displayerror', fail); signal.addEventListener('abort', abort, { once: true });
  return () => { engine.off('displayerror', fail); signal.removeEventListener('abort', abort); };
}

export function destroyBook(book: Book) {
  // Pending Paint Work - Rendition.destroy leaves queued start/layout callbacks alive after its book reference is cleared.
  book.rendition?.q.stop();
  // CSS URLs - Archive.destroy revokes archive URLs, but Resources.destroy omits generated stylesheet URLs.
  const resources = book.resources as typeof book.resources & { replacementUrls?: string[] };
  for (const url of resources?.replacementUrls || []) if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
  book.destroy();
}
