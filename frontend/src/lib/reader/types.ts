export interface TocNode {
  href: string;
  label?: string;
  subitems?: TocNode[];
}

export interface EpubContents {
  document: Document;
  sectionIndex?: number;
  range: (cfi: string) => Range;
}

export interface EpubVisibleSection {
  index: number;
  layout: { width: number; divisor: number };
  width: () => number;
  expand: () => void;
}

export interface EpubLocation {
  start: {
    cfi: string;
    href?: string;
  };
  end: {
    cfi: string;
  };
}

export interface EpubNavigation {
  toc?: TocNode[];
}

export interface EpubSpineItem {
  cfiBase: string;
  index: number;
  document: Document;
  load: (_loader: unknown) => Promise<Document>;
  cfiFromElement: (element: Element) => string;
  wordCount?: number;
}

export interface EpubBook {
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

export interface EpubRendition {
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

export interface ParsedCfiPath {
  steps: unknown[];
  terminal: unknown;
}

export interface ParsedCfi {
  base: unknown;
  path: ParsedCfiPath;
}

export interface EpubCfiHelper {
  parse: (_value: string) => ParsedCfi;
  equalStep: (_a: unknown, _b: unknown) => boolean;
  segmentString: (_value: unknown) => string;
}

export interface EpubWithCfiConstructor {
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
