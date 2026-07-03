import ePub from 'epubjs';
import NoSleep from 'nosleep.js';
import type { CreateActivityRequest } from '../../generated/model/createActivityRequest';
import type { UpdateProgressRequest } from '../../generated/model/updateProgressRequest';
import {
  READER_COLOR_SCHEMES,
  type ReaderColorScheme,
  type ReaderFontFamily,
} from '../../utils/localSettings';
import type { EpubBook, EpubRendition, ReaderStats, ReaderTocItem } from './types';
import {
  countWords,
  getBookWordPosition,
  getCFIFromXPath,
  getParsedTOC,
  getVisibleWordCount,
  getXPathFromCFI,
} from './epubUtils';
import { registerRenditionGestures } from './gestures';

export type { ReaderStats, ReaderTocItem } from './types';

const THEME_FILE = '/assets/reader/themes.css';
const FONT_FILE = '/assets/reader/fonts.css';

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
  private gestureDispose: (() => void) | null = null;
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

    this.gestureDispose = registerRenditionGestures(this.rendition, {
      isPaginationDisabled: () => this.isPaginationDisabled(),
      nextPage: () => this.nextPage(),
      prevPage: () => this.prevPage(),
      onSwipeDown: () => this.onSwipeDown(),
      onSwipeUp: () => this.onSwipeUp(),
      onCenterTap: () => this.onCenterTap(),
    });

    this.initDocumentListeners();

    this.book.ready.then(this.setupReader.bind(this)).catch(error => {
      if (this.destroyed) {
        return;
      }
      this.onError(error instanceof Error ? error.message : 'Unable to initialize reader');
      this.onLoading(false);
    });
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
    READER_COLOR_SCHEMES.forEach(theme => this.rendition.themes.register(theme, THEME_FILE));

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
        const currentThemeIdx = READER_COLOR_SCHEMES.indexOf(currentTheme);
        const colorScheme =
          READER_COLOR_SCHEMES.length === currentThemeIdx + 1
            ? READER_COLOR_SCHEMES[0]
            : READER_COLOR_SCHEMES[currentThemeIdx + 1];
        if (colorScheme) {
          this.setTheme({ colorScheme });
        }
      }
    };

    document.addEventListener('keyup', this.keyupHandler, false);
  }

  private async setupReader() {
    this.bookState.words = await countWords(this.book);
    const { cfi } = await getCFIFromXPath(this.book, this.rendition, this.bookState.progress);
    await this.setPosition(cfi);
    const { element } = await getCFIFromXPath(this.book, this.rendition, this.bookState.progress);
    this.bookState.progressElement = element ?? null;
    this.highlightPositionMarker();
    const stats = await this.getBookStats();
    this.onStats(stats);
    this.bookState.pageStart = Date.now();
    this.onToc(getParsedTOC(this.book));
    this.onLoading(false);
    this.onReady();
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

    // Triple Display - epubjs occasionally renders at the wrong position on a single display()
    // when restoring a CFI; calling it three times is a known workaround to land on the exact page.
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
    const { cfi } = await getCFIFromXPath(this.book, this.rendition, currentProgress);
    this.setTheme(newTheme);
    await this.setPosition(cfi);
    const { element } = await getCFIFromXPath(this.book, this.rendition, currentProgress);
    this.bookState.progressElement = element ?? null;
    this.highlightPositionMarker();
  }

  async createActivity() {
    const WPM_MAX = 2000;
    const WPM_MIN = 100;

    const pageStart = this.bookState.pageStart;
    let elapsedTime = Date.now() - pageStart;
    const pageWords = await getVisibleWordCount(this.book, this.rendition);
    const currentWord = await getBookWordPosition(this.book, this.rendition);
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
    const { element, xpath } = await getXPathFromCFI(this.book, this.rendition, currentCFI.start.cfi);
    const currentWord = await getBookWordPosition(this.book, this.rendition);
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
    const currentWord = await getBookWordPosition(this.book, this.rendition);
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

  destroy() {
    this.destroyed = true;
    if (this.keyupHandler) {
      document.removeEventListener('keyup', this.keyupHandler, false);
    }
    document.removeEventListener('wakelock', this.handleWakeLock);
    if (this.wakeTimeoutId) {
      clearTimeout(this.wakeTimeoutId);
    }
    this.gestureDispose?.();
    void this.noSleep?.disable();
    this.rendition.destroy?.();
    this.book.destroy?.();
  }
}
