import ePub from 'epubjs';
import NoSleep from 'nosleep.js';
import type { CreateActivityRequest } from '../../generated/model/createActivityRequest';
import type { UpdateProgressRequest } from '../../generated/model/updateProgressRequest';
import type { ReaderColorScheme, ReaderFontFamily } from '../../utils/localSettings';

const THEMES: ReaderColorScheme[] = ['light', 'tan', 'blue', 'gray', 'black'];
const THEME_FILE = '/assets/reader/themes.css';
const FONT_FILE = '/assets/reader/fonts.css';

interface TocNode {
  href: string;
  label?: string;
  subitems?: TocNode[];
}

interface EpubContents {
  document: Document;
  sectionIndex?: number;
  range: (cfi: string) => Range;
}

interface EpubVisibleSection {
  index: number;
  layout: { width: number; divisor: number };
  width: () => number;
  expand: () => void;
}

interface EpubLocation {
  start: {
    cfi: string;
    href?: string;
  };
  end: {
    cfi: string;
  };
}

interface EpubNavigation {
  toc?: TocNode[];
}

interface EpubSpineItem {
  cfiBase: string;
  index: number;
  document: Document;
  load: (_loader: unknown) => Promise<Document>;
  cfiFromElement: (element: Element) => string;
  wordCount?: number;
}

interface EpubBook {
  ready: Promise<void>;
  navigation?: EpubNavigation;
  loaded: { navigation: Promise<EpubNavigation> };
  spine: {
    spineItems: EpubSpineItem[];
    get: (index: number) => EpubSpineItem;
    hooks: {
      content: { register: (_callback: (output: Document) => void) => void };
    };
  };
  load: (...args: unknown[]) => unknown;
  renderTo: (element: HTMLElement, options: Record<string, unknown>) => EpubRendition;
  getRange: (cfiRange: string) => Promise<Range>;
  destroy?: () => void;
}

interface EpubRendition {
  next: () => Promise<void>;
  prev: () => Promise<void>;
  display: (target?: string) => Promise<void>;
  currentLocation: () => Promise<EpubLocation>;
  getContents: () => EpubContents[];
  themes: {
    default: (styles: Record<string, unknown>) => void;
    register: (name: string, styles: Record<string, unknown> | string) => void;
    select: (name: string) => void;
  };
  hooks: {
    content: { register: (_callback: () => void) => void };
    render: { register: (_callback: (contents: EpubContents) => void) => void };
  };
  manager?: {
    visible?: () => EpubVisibleSection[];
  };
  views: () => { container: { scrollLeft: number } };
  destroy?: () => void;
}

interface ParsedCfiPath {
  steps: unknown[];
  terminal: unknown;
}

interface ParsedCfi {
  base: unknown;
  path: ParsedCfiPath;
}

interface EpubCfiHelper {
  parse: (_value: string) => ParsedCfi;
  equalStep: (_a: unknown, _b: unknown) => boolean;
  segmentString: (_value: unknown) => string;
}

interface EpubWithCfiConstructor {
  CFI: new () => EpubCfiHelper;
}

export interface ReaderStats {
  chapterName: string;
  sectionPage: number;
  sectionTotalPages: number;
  percentage: number;
}

export interface ReaderTocItem {
  title: string;
  href: string;
}

interface BookState {
  pages: number;
  percentage: number;
  progress: string;
  progressElement: Element | null;
  readActivity: unknown[];
  words: number;
  pageStart: number;
}

interface ReaderSettings {
  theme?: {
    colorScheme?: ReaderColorScheme;
    fontFamily?: string;
    fontSize?: number;
  };
}

interface EBookReaderOptions {
  container: HTMLElement;
  bookUrl: string;
  documentId: string;
  initialProgress?: string;
  deviceId: string;
  deviceName: string;
  colorScheme: ReaderColorScheme;
  fontFamily: ReaderFontFamily;
  fontSize: number;
  onReady: () => void;
  onLoading: (_loading: boolean) => void;
  onError: (_message: string) => void;
  onStats: (_stats: ReaderStats) => void;
  onToc: (_toc: ReaderTocItem[]) => void;
  onSaveProgress: (_payload: UpdateProgressRequest) => Promise<void>;
  onCreateActivity: (_payload: CreateActivityRequest) => Promise<void>;
  isPaginationDisabled: () => boolean;
  onSwipeDown: () => void;
  onSwipeUp: () => void;
  onCenterTap: () => void;
}

export class EBookReader {
  private container: HTMLElement;
  private bookUrl: string;
  private documentId: string;
  private deviceId: string;
  private deviceName: string;
  private readerSettings: ReaderSettings = {};
  private bookState: BookState;
  private book: EpubBook;
  private rendition: EpubRendition;
  private noSleep: NoSleep | null = null;
  private wakeTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private onReady: () => void;
  private onLoading: (_loading: boolean) => void;
  private onError: (_message: string) => void;
  private onStats: (_stats: ReaderStats) => void;
  private onToc: (_toc: ReaderTocItem[]) => void;
  private onSaveProgress: (_payload: UpdateProgressRequest) => Promise<void>;
  private onCreateActivity: (_payload: CreateActivityRequest) => Promise<void>;
  private isPaginationDisabled: () => boolean;
  private onSwipeDown: () => void;
  private onSwipeUp: () => void;
  private onCenterTap: () => void;
  private keyupHandler: ((event: KeyboardEvent) => void) | null = null;
  private wheelTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(options: EBookReaderOptions) {
    this.container = options.container;
    this.bookUrl = options.bookUrl;
    this.documentId = options.documentId;
    this.deviceId = options.deviceId;
    this.deviceName = options.deviceName;
    this.onReady = options.onReady;
    this.onLoading = options.onLoading;
    this.onError = options.onError;
    this.onStats = options.onStats;
    this.onToc = options.onToc;
    this.onSaveProgress = options.onSaveProgress;
    this.onCreateActivity = options.onCreateActivity;
    this.isPaginationDisabled = options.isPaginationDisabled;
    this.onSwipeDown = options.onSwipeDown;
    this.onSwipeUp = options.onSwipeUp;
    this.onCenterTap = options.onCenterTap;

    this.bookState = {
      pages: 0,
      percentage: 0,
      progress: options.initialProgress ?? '',
      progressElement: null,
      readActivity: [],
      words: 0,
      pageStart: Date.now(),
    };

    this.loadSettings();
    this.readerSettings.theme = {
      colorScheme: options.colorScheme,
      fontFamily: options.fontFamily,
      fontSize: options.fontSize,
    };

    this.onLoading(true);
    this.book = ePub(this.bookUrl, { openAs: 'epub' }) as EpubBook;
    this.rendition = this.book.renderTo(this.container, {
      manager: 'default',
      flow: 'paginated',
      width: '100%',
      height: '100%',
      allowScriptedContent: true,
    });

    this.initCSP();
    this.initWakeLock();
    this.initThemes();
    this.initViewerListeners();
    this.initDocumentListeners();

    this.book.ready.then(this.setupReader.bind(this)).catch(error => {
      if (this.destroyed) {
        return;
      }
      this.onError(error instanceof Error ? error.message : 'Unable to initialize reader');
      this.onLoading(false);
    });
  }

  private loadSettings() {
    this.readerSettings = {
      theme: this.readerSettings.theme ?? {},
    };
  }

  private initWakeLock() {
    this.noSleep = new NoSleep();
    document.addEventListener('wakelock', this.handleWakeLock);
  }

  private handleWakeLock = () => {
    if (!this.noSleep) {
      return;
    }

    if (this.wakeTimeoutId) {
      clearTimeout(this.wakeTimeoutId);
    }
    this.wakeTimeoutId = setTimeout(
      () => {
        void this.noSleep?.disable();
      },
      1000 * 60 * 10
    );

    void this.noSleep.enable();
  };

  private initThemes() {
    THEMES.forEach(theme => this.rendition.themes.register(theme, THEME_FILE));

    let themeLinkEl = document.querySelector('#themes') as HTMLLinkElement | null;
    if (!themeLinkEl) {
      themeLinkEl = document.createElement('link');
      themeLinkEl.id = 'themes';
      themeLinkEl.rel = 'stylesheet';
      themeLinkEl.href = THEME_FILE;
      document.head.append(themeLinkEl);
    }

    this.rendition.themes.default({
      '*': {
        'font-size': 'var(--editor-font-size) !important',
        'font-family': 'var(--editor-font-family) !important',
      },
    });

    this.rendition.hooks.content.register(() => {
      this.setTheme();
      this.rendition.getContents().forEach(content => {
        const existing = content.document.getElementById('reader-fonts');
        if (!existing) {
          const nextLink = content.document.head.appendChild(
            content.document.createElement('link')
          );
          nextLink.id = 'reader-fonts';
          nextLink.rel = 'stylesheet';
          nextLink.href = FONT_FILE;
        }
      });
    });
  }

  private initCSP() {
    const protocol = document.location.protocol;
    const host = document.location.host;
    const cspURL = `${protocol}//${host}`;

    this.book.spine.hooks.content.register(output => {
      const cspWrapper = document.createElement('div');
      cspWrapper.innerHTML = `
        <meta
          http-equiv="Content-Security-Policy"
          content="require-trusted-types-for 'script';
                   style-src 'self' blob: 'unsafe-inline' ${cspURL};
                   object-src 'none';
                   script-src 'none';"
        >`;
      const cspMeta = cspWrapper.children[0];
      if (cspMeta) {
        output.head.append(cspMeta);
      }
    });
  }

  private initViewerListeners() {
    const nextPage = this.nextPage.bind(this);
    const prevPage = this.prevPage.bind(this);

    let touchStartX = 0;
    let touchStartY = 0;
    let touchEndX = 0;
    let touchEndY = 0;

    const handleSwipeDown = () => {
      this.resetWheelCooldown();
      this.onSwipeDown();
    };

    const handleSwipeUp = () => {
      this.resetWheelCooldown();
      this.onSwipeUp();
    };

    const handleGesture = () => {
      const drasticity = 50;

      if (touchEndY - drasticity > touchStartY) {
        return handleSwipeDown();
      }

      if (touchEndY + drasticity < touchStartY) {
        return handleSwipeUp();
      }

      if (!this.isPaginationDisabled() && touchEndX + drasticity < touchStartX) {
        void nextPage();
      }

      if (!this.isPaginationDisabled() && touchEndX - drasticity > touchStartX) {
        void prevPage();
      }
    };

    this.rendition.hooks.render.register((contents: EpubContents) => {
      const renderDoc = contents.document;

      const wakeLockListener = () => {
        renderDoc.dispatchEvent(new CustomEvent('wakelock'));
      };
      renderDoc.addEventListener('click', wakeLockListener);
      renderDoc.addEventListener('gesturechange', wakeLockListener);
      renderDoc.addEventListener('touchstart', wakeLockListener);

      renderDoc.addEventListener('click', (event: MouseEvent) => {
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const barPixels = windowHeight * 0.2;
        const pagePixels = windowWidth * 0.2;
        const top = barPixels;
        const bottom = window.innerHeight - top;
        const left = pagePixels;
        const right = windowWidth - left;
        const leftOffset = this.rendition.views().container.scrollLeft;
        const yCoord = event.clientY;
        const xCoord = event.clientX - leftOffset;

        if (yCoord < top) {
          handleSwipeDown();
        } else if (yCoord > bottom) {
          handleSwipeUp();
        } else if (!this.isPaginationDisabled() && xCoord < left) {
          void prevPage();
        } else if (!this.isPaginationDisabled() && xCoord > right) {
          void nextPage();
        } else {
          this.onCenterTap();
        }
      });

      renderDoc.addEventListener('wheel', (event: WheelEvent) => {
        if (this.wheelTimeoutId) {
          return;
        }

        if (event.deltaY > 25) {
          handleSwipeUp();
          return;
        }
        if (event.deltaY < -25) {
          handleSwipeDown();
        }
      });

      renderDoc.addEventListener(
        'touchstart',
        (event: TouchEvent) => {
          touchStartX = event.changedTouches[0]?.screenX ?? 0;
          touchStartY = event.changedTouches[0]?.screenY ?? 0;
        },
        false
      );

      renderDoc.addEventListener(
        'touchend',
        (event: TouchEvent) => {
          touchEndX = event.changedTouches[0]?.screenX ?? 0;
          touchEndY = event.changedTouches[0]?.screenY ?? 0;
          handleGesture();
        },
        false
      );
    });
  }

  private resetWheelCooldown() {
    if (this.wheelTimeoutId) {
      clearTimeout(this.wheelTimeoutId);
      this.wheelTimeoutId = null;
    }

    this.wheelTimeoutId = setTimeout(() => {
      this.wheelTimeoutId = null;
    }, 400);
  }

  private initDocumentListeners() {
    const nextPage = this.nextPage.bind(this);
    const prevPage = this.prevPage.bind(this);

    this.keyupHandler = (event: KeyboardEvent) => {
      if ((event.keyCode || event.which) === 37) {
        void prevPage();
      }
      if ((event.keyCode || event.which) === 39) {
        void nextPage();
      }
      if ((event.keyCode || event.which) === 84) {
        const currentTheme = this.readerSettings.theme?.colorScheme || 'tan';
        const currentThemeIdx = THEMES.indexOf(currentTheme);
        const colorScheme =
          THEMES.length === currentThemeIdx + 1 ? THEMES[0] : THEMES[currentThemeIdx + 1];
        if (colorScheme) {
          this.setTheme({ colorScheme });
        }
      }
    };

    document.addEventListener('keyup', this.keyupHandler, false);
  }

  private async setupReader() {
    this.bookState.words = await this.countWords();
    const { cfi } = await this.getCFIFromXPath(this.bookState.progress);
    await this.setPosition(cfi);
    const { element } = await this.getCFIFromXPath(this.bookState.progress);
    this.bookState.progressElement = element ?? null;
    this.highlightPositionMarker();
    const stats = await this.getBookStats();
    this.onStats(stats);
    this.bookState.pageStart = Date.now();
    this.onToc(this.getParsedTOC());
    this.onLoading(false);
    this.onReady();
  }

  private getParsedTOC(): ReaderTocItem[] {
    if (!this.book.navigation?.toc) {
      return [];
    }

    return this.book.navigation.toc.reduce((agg: ReaderTocItem[], item) => {
      const sectionTitle = item.label?.trim() ?? '';
      agg.push({ title: sectionTitle || 'Untitled', href: item.href });
      if (!item.subitems || item.subitems.length === 0) {
        return agg;
      }

      const allSubSections = item.subitems.map(subitem => {
        let itemTitle = subitem.label?.trim() ?? 'Untitled';
        if (sectionTitle !== '') {
          itemTitle = `${sectionTitle} - ${itemTitle}`;
        }
        return { title: itemTitle, href: subitem.href };
      });
      agg.push(...allSubSections);
      return agg;
    }, []);
  }

  setTheme(newTheme?: { colorScheme?: ReaderColorScheme; fontFamily?: string; fontSize?: number }) {
    this.readerSettings.theme =
      typeof this.readerSettings.theme === 'object' && this.readerSettings.theme !== null
        ? this.readerSettings.theme
        : {};

    Object.assign(this.readerSettings.theme, newTheme);

    const colorScheme = this.readerSettings.theme.colorScheme || 'tan';
    const fontFamily = this.readerSettings.theme.fontFamily || 'serif';
    const fontSize = this.readerSettings.theme.fontSize || 1;

    this.rendition.themes.select(colorScheme);

    const themeColorEl = document.querySelector("[name='theme-color']");
    const themeStyleSheet = (document.querySelector('#themes') as HTMLLinkElement | null)?.sheet;
    const themeStyleRule = themeStyleSheet
      ? Array.from(themeStyleSheet.cssRules).find(
          item => (item as CSSStyleRule).selectorText === `.${colorScheme}`
        )
      : null;

    if (!themeStyleRule) {
      return;
    }

    const backgroundColor = (themeStyleRule as CSSStyleRule).style.backgroundColor;
    themeColorEl?.setAttribute('content', backgroundColor);
    document.body.style.backgroundColor = backgroundColor;

    this.rendition.getContents().forEach(item => {
      item.document.documentElement.style.setProperty('--editor-font-family', fontFamily);
      item.document.documentElement.style.setProperty('--editor-font-size', `${fontSize}em`);
      item.document.querySelectorAll('.highlight').forEach(element => {
        Object.assign((element as HTMLElement).style, {
          background: backgroundColor,
        });
      });
    });
  }

  highlightPositionMarker() {
    if (!this.bookState.progressElement) {
      return;
    }

    this.rendition.getContents().forEach(item => {
      item.document.querySelectorAll('.highlight').forEach(element => {
        element.removeAttribute('style');
        element.classList.remove('highlight');
      });
    });

    const backgroundColor = getComputedStyle(
      this.bookState.progressElement.ownerDocument.body
    ).backgroundColor;

    Object.assign((this.bookState.progressElement as HTMLElement).style, {
      background: backgroundColor,
      filter: 'invert(0.2)',
    });
    this.bookState.progressElement.classList.add('highlight');
  }

  async nextPage() {
    try {
      await this.createActivity();
    } catch (error) {
      this.onError(error instanceof Error ? error.message : 'Unable to save reader activity');
    }

    await this.rendition.next();
    this.bookState.pageStart = Date.now();
    const stats = await this.getBookStats();
    this.onStats(stats);
    void this.createProgress();
  }

  async prevPage() {
    await this.rendition.prev();
    this.bookState.pageStart = Date.now();
    const stats = await this.getBookStats();
    this.onStats(stats);
    void this.createProgress();
  }

  async displayHref(href: string) {
    await this.rendition.display(href);
  }

  async setPosition(cfi?: string) {
    if (!cfi) {
      return;
    }

    await this.rendition.display(cfi);
    await this.rendition.display(cfi);
    await this.rendition.display(cfi);
    this.highlightPositionMarker();
  }

  async applyThemeChange(newTheme: {
    colorScheme?: ReaderColorScheme;
    fontFamily?: string;
    fontSize?: number;
  }) {
    const currentProgress = this.bookState.progress;
    const { cfi } = await this.getCFIFromXPath(currentProgress);
    this.setTheme(newTheme);
    await this.setPosition(cfi);
    const { element } = await this.getCFIFromXPath(currentProgress);
    this.bookState.progressElement = element ?? null;
    this.highlightPositionMarker();
  }

  async createActivity() {
    const WPM_MAX = 2000;
    const WPM_MIN = 100;

    const pageStart = this.bookState.pageStart;
    let elapsedTime = Date.now() - pageStart;
    const pageWords = await this.getVisibleWordCount();
    const currentWord = await this.getBookWordPosition();
    const percentRead = pageWords / this.bookState.words;
    const pageWPM = pageWords / (elapsedTime / 60000);

    if (pageWPM >= WPM_MAX) {
      return;
    }
    if (pageWPM < WPM_MIN) {
      elapsedTime = (pageWords / WPM_MIN) * 60000;
    }

    if (!Number.isFinite(percentRead) || percentRead <= 0 || this.bookState.words <= 0) {
      return;
    }

    const totalPages = Math.round(1 / percentRead);
    if (!Number.isFinite(totalPages) || totalPages <= 0) {
      return;
    }

    const currentPage = Math.round((currentWord * totalPages) / this.bookState.words);
    if (!Number.isFinite(currentPage) || currentPage < 0) {
      return;
    }

    const payload: CreateActivityRequest = {
      device_id: this.deviceId,
      device_name: this.deviceName,
      activity: [
        {
          document_id: this.documentId,
          duration: Math.round(elapsedTime / 1000),
          start_time: Math.round(pageStart / 1000),
          page: currentPage,
          pages: totalPages,
        },
      ],
    };

    await this.onCreateActivity(payload);
  }

  async createProgress() {
    const currentCFI = await this.rendition.currentLocation();
    const { element, xpath } = await this.getXPathFromCFI(currentCFI.start.cfi);
    const currentWord = await this.getBookWordPosition();
    this.bookState.progress = xpath ?? '';
    this.bookState.progressElement = element ?? null;

    const percentage =
      this.bookState.words > 0
        ? Math.round((currentWord / this.bookState.words) * 100000) / 100000
        : 0;
    this.bookState.percentage = Math.round(percentage * 10000) / 100;

    const payload: UpdateProgressRequest = {
      document_id: this.documentId,
      device_id: this.deviceId,
      device_name: this.deviceName,
      percentage,
      progress: this.bookState.progress,
    };

    try {
      await this.onSaveProgress(payload);
    } catch (error) {
      this.onError(error instanceof Error ? error.message : 'Unable to save reader progress');
    }
  }

  sectionProgress() {
    const visibleItems = this.rendition.manager?.visible?.() ?? [];
    if (visibleItems.length === 0) {
      return null;
    }
    const visibleSection = visibleItems[0];
    if (!visibleSection) {
      return null;
    }

    const totalBlocks = visibleSection.width() / visibleSection.layout.width;
    const leftOffset = this.rendition.views().container.scrollLeft;
    const sectionCurrentPage = Math.round(leftOffset / visibleSection.layout.width) + 1;

    return {
      sectionPages: totalBlocks,
      sectionCurrentPage,
    };
  }

  async getBookStats(): Promise<ReaderStats> {
    const currentProgress = this.sectionProgress();
    if (!currentProgress) {
      return {
        sectionPage: 0,
        sectionTotalPages: 0,
        chapterName: 'N/A',
        percentage: this.bookState.percentage,
      };
    }

    const currentLocation = await this.rendition.currentLocation();
    const currentWord = await this.getBookWordPosition();
    const currentTOC = this.book.navigation?.toc?.find(
      item => item.href === currentLocation.start.href
    );

    return {
      sectionPage: currentProgress.sectionCurrentPage,
      sectionTotalPages: currentProgress.sectionPages,
      chapterName: currentTOC ? currentTOC.label?.trim() || 'N/A' : 'N/A',
      percentage:
        this.bookState.words > 0
          ? Math.round((currentWord / this.bookState.words) * 10000) / 100
          : 0,
    };
  }

  async getXPathFromCFI(cfi: string) {
    const cfiBaseMatch = cfi.match(/\(([^!]+)/);
    if (!cfiBaseMatch?.[1]) {
      return {} as { xpath?: string; element?: Element | null };
    }
    const startCFI = cfiBaseMatch[1];

    const docFragmentIndex =
      (this.book.spine.spineItems.find(item => item.cfiBase === startCFI)?.index ?? -1) + 1;
    if (docFragmentIndex <= 0) {
      return {} as { xpath?: string; element?: Element | null };
    }

    const basePos = `/body/DocFragment[${docFragmentIndex}]/body`;
    const contents = this.rendition.getContents()[0];
    const currentNodeStart = contents?.range(cfi).startContainer;
    if (!currentNodeStart) {
      return {} as { xpath?: string; element?: Element | null };
    }

    let currentNode: Node | null = currentNodeStart;
    const element =
      currentNode.nodeType === Node.ELEMENT_NODE
        ? (currentNode as Element)
        : currentNode.parentElement;

    let allPos = '';
    while (currentNode && currentNode.nodeName !== 'BODY') {
      let parentElement: Element | null = currentNode.parentElement;
      if (!parentElement) {
        break;
      }

      if (currentNode.nodeType !== Node.ELEMENT_NODE) {
        currentNode = parentElement;
        continue;
      }

      while (parentElement.nodeName === 'A' && parentElement.parentElement) {
        parentElement = parentElement.parentElement;
      }

      const currentElement = currentNode as Element;
      const allDescendents = parentElement.querySelectorAll(currentElement.nodeName);
      const relativeIndex = Array.from(allDescendents).indexOf(currentElement) + 1;
      const nodePos = `${currentElement.nodeName.toLowerCase()}[${relativeIndex}]`;
      currentNode = parentElement;
      allPos = `/${nodePos}${allPos}`;
    }

    return { xpath: `${basePos}${allPos}`, element };
  }

  async getCFIFromXPath(xpath?: string) {
    if (!xpath) {
      return {} as { cfi?: string; element?: Element | null };
    }

    const fragMatch = xpath.match(/^\/body\/DocFragment\[(\d+)\]/);
    if (!fragMatch?.[1]) {
      return {} as { cfi?: string; element?: Element | null };
    }

    const spinePosition = Number.parseInt(fragMatch[1], 10) - 1;
    const sectionItem = this.book.spine.get(spinePosition);
    await sectionItem.load(this.book.load.bind(this.book));

    const renderedContent = this.rendition
      .getContents()
      .find(item => item.sectionIndex == spinePosition);
    const docItem = renderedContent?.document || sectionItem.document;

    const namespaceURI = docItem.documentElement.namespaceURI;
    let remainingXPath = xpath
      .replace(fragMatch[0], '/html')
      .replace(/\.(\d+)$/, '')
      .replace(/\/text\(\)(\[\d+\])?$/, '');

    const derivedSelectorElement = remainingXPath
      .replace(/^\/html\/body/, 'body')
      .split('/')
      .reduce(
        (element: ParentNode | null, item: string) => {
          if (!element) {
            return null;
          }

          const indexMatch = item.match(/(\w+)\[(\d+)\]$/);
          if (!indexMatch) {
            return element.querySelector(item);
          }

          const [, tag, rawIndex] = indexMatch;
          if (!tag || !rawIndex) {
            return null;
          }
          return element.querySelectorAll(tag)[Number.parseInt(rawIndex, 10) - 1] ?? null;
        },
        docItem as ParentNode | null
      );

    if (namespaceURI) {
      remainingXPath = remainingXPath.split('/').join('/ns:');
    }

    const docSearch = docItem.evaluate(remainingXPath, docItem, prefix => {
      if (prefix === 'ns') {
        return namespaceURI;
      }
      return null;
    });

    const xpathElement = docSearch.iterateNext();
    const element = xpathElement || derivedSelectorElement;
    const isElementNode = Boolean(element && (element as Node).nodeType === Node.ELEMENT_NODE);
    if (!isElementNode) {
      return {} as { cfi?: string; element?: Element | null };
    }

    const resolvedElement = element as Element;

    let cfi = sectionItem.cfiFromElement(resolvedElement);
    if (cfi.endsWith('!/)')) {
      cfi = `${cfi.slice(0, -1)}0)`;
    }

    return { cfi, element: resolvedElement };
  }

  async getVisibleWordCount() {
    const visibleText = await this.getVisibleText();
    return visibleText.trim().split(/\s+/).length;
  }

  async getBookWordPosition() {
    const contents = this.rendition.getContents()[0];
    if (!contents) {
      return 0;
    }

    const spineItem = this.book.spine.get(contents.sectionIndex ?? 0);
    const firstElement = spineItem.document.body.children[0];
    if (!firstElement) {
      return 0;
    }

    const firstCFI = spineItem.cfiFromElement(firstElement);
    const currentLocation = await this.rendition.currentLocation();
    const cfiRange = this.getCFIRange(firstCFI, currentLocation.start.cfi);
    const textRange = await this.book.getRange(cfiRange);
    const chapterText = textRange.toString();
    const chapterWordPosition = chapterText.trim().split(/\s+/).length;
    const preChapterWordPosition = this.book.spine.spineItems
      .slice(0, contents.sectionIndex ?? 0)
      .reduce((totalCount, item) => totalCount + (item.wordCount ?? 0), 0);

    return chapterWordPosition + preChapterWordPosition;
  }

  async getVisibleText() {
    this.rendition.manager?.visible?.()?.forEach(item => item.expand());
    const currentLocation = await this.rendition.currentLocation();
    const cfiRange = this.getCFIRange(currentLocation.start.cfi, currentLocation.end.cfi);
    const textRange = await this.book.getRange(cfiRange);
    return textRange.toString();
  }

  getCFIRange(a: string, b: string) {
    const CFI = new (ePub as unknown as EpubWithCfiConstructor).CFI();
    const start = CFI.parse(a);
    const end = CFI.parse(b);
    const cfi: {
      range: boolean;
      base: unknown;
      path: ParsedCfiPath;
      start: ParsedCfiPath;
      end: ParsedCfiPath;
    } = {
      range: true,
      base: start.base,
      path: { steps: [], terminal: null },
      start: start.path,
      end: end.path,
    };

    const len = cfi.start.steps.length;
    for (let i = 0; i < len; i += 1) {
      if (CFI.equalStep(cfi.start.steps[i], cfi.end.steps[i])) {
        if (i === len - 1) {
          if (cfi.start.terminal === cfi.end.terminal) {
            cfi.path.steps.push(cfi.start.steps[i]);
            cfi.range = false;
          }
        } else {
          cfi.path.steps.push(cfi.start.steps[i]);
        }
      } else {
        break;
      }
    }

    cfi.start.steps = cfi.start.steps.slice(cfi.path.steps.length);
    cfi.end.steps = cfi.end.steps.slice(cfi.path.steps.length);

    return `epubcfi(${CFI.segmentString(cfi.base)}!${CFI.segmentString(cfi.path)},${CFI.segmentString(cfi.start)},${CFI.segmentString(cfi.end)})`;
  }

  async countWords() {
    const spineWC = await Promise.all(
      this.book.spine.spineItems.map(async item => {
        const newDoc = await item.load(this.book.load.bind(this.book));
        const spineWords = ((newDoc as unknown as HTMLElement).innerText || '')
          .trim()
          .split(/\s+/).length;
        item.wordCount = spineWords;
        return spineWords;
      })
    );

    return spineWC.reduce((totalCount, itemCount) => totalCount + itemCount, 0);
  }

  destroy() {
    this.destroyed = true;
    if (this.keyupHandler) {
      document.removeEventListener('keyup', this.keyupHandler, false);
    }
    document.removeEventListener('wakelock', this.handleWakeLock);
    if (this.wakeTimeoutId) {
      clearTimeout(this.wakeTimeoutId);
    }
    if (this.wheelTimeoutId) {
      clearTimeout(this.wheelTimeoutId);
    }
    void this.noSleep?.disable();
    this.rendition.destroy?.();
    this.book.destroy?.();
  }
}
