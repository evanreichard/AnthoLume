import DefaultViewManager from 'epubjs/src/managers/default/index.js';
import type Book from 'epubjs/types/book';

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

export function destroyBook(book: Book) {
  // CSS URLs - Archive.destroy revokes archive URLs, but Resources.destroy omits generated stylesheet URLs.
  const resources = book.resources as typeof book.resources & { replacementUrls?: string[] };
  for (const url of resources?.replacementUrls || []) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  book.destroy();
}
