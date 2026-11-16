declare module 'epubjs/src/managers/default/index.js' {
  export default class DefaultViewManager {
    settings: { fullsize: boolean };
    container: HTMLElement;
    stage: { orientationChangeFunc: EventListener };
    destroy(): void;
    _onScroll?: EventListener;
    onScroll(event: Event): void;
    addEventListeners(): void;
    removeEventListeners(): void;
  }
}
