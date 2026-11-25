declare module 'epubjs/src/managers/default/index.js' {
  type PageLocation = {
    index: number;
    href: string;
    pages: number[];
    totalPages: number;
    mapping: { start: string; end: string };
  };
  type VisibleView = {
    section: { index: number; cfiBase: string };
    iframe: HTMLIFrameElement;
    contents: { document: Document };
  };
  export default class DefaultViewManager {
    settings: { fullsize: boolean };
    container: HTMLElement;
    stage: { orientationChangeFunc: EventListener };
    destroy(): void;
    _onScroll?: EventListener;
    onScroll(event: Event): void;
    addEventListeners(): void;
    removeEventListeners(): void;
    paginatedLocation(): PageLocation[];
    visible(): VisibleView[];
  }
}
