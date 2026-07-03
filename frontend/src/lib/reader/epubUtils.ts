import ePub from 'epubjs';
import type {
  EpubBook,
  EpubRendition,
  EpubWithCfiConstructor,
  ParsedCfiPath,
  ReaderTocItem,
} from './types';

export function getParsedTOC(book: EpubBook): ReaderTocItem[] {
  if (!book.navigation?.toc) {
    return [];
  }

  return book.navigation.toc.reduce((agg: ReaderTocItem[], item) => {
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

export async function countWords(book: EpubBook) {
  const spineWC = await Promise.all(
    book.spine.spineItems.map(async item => {
      const newDoc = await item.load(book.load.bind(book));
      const spineWords = ((newDoc as unknown as HTMLElement).innerText || '')
        .trim()
        .split(/\s+/).length;
      item.wordCount = spineWords;
      return spineWords;
    })
  );

  return spineWC.reduce((totalCount, itemCount) => totalCount + itemCount, 0);
}

export function getCFIRange(a: string, b: string) {
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

export async function getVisibleText(book: EpubBook, rendition: EpubRendition) {
  rendition.manager?.visible?.()?.forEach(item => item.expand());
  const currentLocation = await rendition.currentLocation();
  const cfiRange = getCFIRange(currentLocation.start.cfi, currentLocation.end.cfi);
  const textRange = await book.getRange(cfiRange);
  return textRange.toString();
}

export async function getVisibleWordCount(book: EpubBook, rendition: EpubRendition) {
  const visibleText = await getVisibleText(book, rendition);
  return visibleText.trim().split(/\s+/).length;
}

export async function getBookWordPosition(book: EpubBook, rendition: EpubRendition) {
  const contents = rendition.getContents()[0];
  if (!contents) {
    return 0;
  }

  const spineItem = book.spine.get(contents.sectionIndex ?? 0);
  const firstElement = spineItem.document.body.children[0];
  if (!firstElement) {
    return 0;
  }

  const firstCFI = spineItem.cfiFromElement(firstElement);
  const currentLocation = await rendition.currentLocation();
  const cfiRange = getCFIRange(firstCFI, currentLocation.start.cfi);
  const textRange = await book.getRange(cfiRange);
  const chapterText = textRange.toString();
  const chapterWordPosition = chapterText.trim().split(/\s+/).length;
  const preChapterWordPosition = book.spine.spineItems
    .slice(0, contents.sectionIndex ?? 0)
    .reduce((totalCount, item) => totalCount + (item.wordCount ?? 0), 0);

  return chapterWordPosition + preChapterWordPosition;
}

export async function getXPathFromCFI(book: EpubBook, rendition: EpubRendition, cfi: string) {
  const cfiBaseMatch = cfi.match(/\(([^!]+)/);
  if (!cfiBaseMatch?.[1]) {
    return {} as { xpath?: string; element?: Element | null };
  }
  const startCFI = cfiBaseMatch[1];

  const docFragmentIndex =
    (book.spine.spineItems.find(item => item.cfiBase === startCFI)?.index ?? -1) + 1;
  if (docFragmentIndex <= 0) {
    return {} as { xpath?: string; element?: Element | null };
  }

  const basePos = `/body/DocFragment[${docFragmentIndex}]/body`;
  const contents = rendition.getContents()[0];
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

export async function getCFIFromXPath(
  book: EpubBook,
  rendition: EpubRendition,
  xpath?: string
) {
  if (!xpath) {
    return {} as { cfi?: string; element?: Element | null };
  }

  const fragMatch = xpath.match(/^\/body\/DocFragment\[(\d+)\]/);
  if (!fragMatch?.[1]) {
    return {} as { cfi?: string; element?: Element | null };
  }

  const spinePosition = Number.parseInt(fragMatch[1], 10) - 1;
  const sectionItem = book.spine.get(spinePosition);
  await sectionItem.load(book.load.bind(book));

  const renderedContent = rendition
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
