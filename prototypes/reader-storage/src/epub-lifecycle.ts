import DefaultViewManager from 'epubjs/src/managers/default/index.js';
import type Book from 'epubjs/types/book';
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
    const path = decodeURIComponent(book.resolve(input)).replace(/^\//, '');
    const doc = policy.documents.get(path);
    return doc ? Promise.resolve(doc.cloneNode(true)) : Promise.reject(new Error('Unvalidated engine document request'));
  };
}

export function destroyBook(book: Book) {
  // CSS URLs - Archive.destroy revokes archive URLs, but Resources.destroy omits generated stylesheet URLs.
  const resources = book.resources as typeof book.resources & { replacementUrls?: string[] };
  for (const url of resources?.replacementUrls || []) if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
  book.destroy();
}
