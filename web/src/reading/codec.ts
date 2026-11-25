import { EpubCFI } from 'epubjs';
import type Book from 'epubjs/types/book';
import type Section from 'epubjs/types/section';

export type CodecResult =
  | { ok: true; cfi: string; original: string; precision: 'element' }
  | { ok: false; original: string; reason: string; phase: 'position' | 'chapter' };

export function parseKO(original: string): { spine: number; steps: { tag: string; index: number }[] } {
  const match =
    /^\/body\/DocFragment\[([1-9]\d*)\]\/body((?:\/[a-zA-Z][\w-]*(?:\[[1-9]\d*\])?)*)(?:\/text\(\)(?:\[[1-9]\d*\])?)?(?:\.\d+)?$/.exec(
      original,
    );
  if (!match) throw new Error('Unsupported KO path');
  return {
    spine: Number(match[1]) - 1,
    steps: (match[2] || '')
      .split('/')
      .filter(Boolean)
      .map((step) => {
        const part = /^([\w-]+)(?:\[(\d+)\])?$/.exec(step)!;
        return { tag: part[1]!.toLowerCase(), index: Number(part[2] || 1) };
      }),
  };
}

export function primaryElementFromKO(doc: Document, original: string): Element | null {
  const { steps } = parseKO(original),
    namespace = doc.documentElement.namespaceURI,
    prefix = namespace ? 'ns:' : '';
  const xpath = `/${prefix}html/${prefix}body` + steps.map(({ tag, index }) => `/${prefix}${tag}[${index}]`).join('');
  return doc.evaluate(xpath, doc, () => namespace, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    .singleNodeValue as Element | null;
}
export function elementFromKO(doc: Document, original: string): Element {
  const { steps } = parseKO(original);
  const primary = primaryElementFromKO(doc, original);
  if (primary) return primary as Element;
  // Legacy Read Contract - Descendant selection is a whole-path fallback only when child-axis XPath misses.
  let element: Element = doc.body || doc.querySelector('body')!;
  if (!element) throw new Error('Missing body');
  for (const { tag, index } of steps) {
    const next = element.querySelectorAll(tag)[index - 1];
    if (!next) throw new Error('Saved element unavailable');
    element = next;
  }
  return element;
}

export function koFromElement(spine: number, element: Element): string {
  let current = element;
  let suffix = '';
  while (current.localName.toLowerCase() !== 'body') {
    const parent = current.parentElement;
    if (!parent) throw new Error('Element outside chapter body');
    if (current.namespaceURI !== element.ownerDocument.documentElement.namespaceURI)
      throw new Error('Unsupported position namespace');
    const tag = current.localName.toLowerCase();
    const index =
      Array.from(parent.children)
        .filter((child) => child.localName === current.localName && child.namespaceURI === current.namespaceURI)
        .indexOf(current) + 1;
    if (!index) throw new Error('Element cannot be represented');
    suffix = `/${tag}[${index}]${suffix}`;
    current = parent;
  }
  const path = `/body/DocFragment[${spine + 1}]/body${suffix}`;
  if (primaryElementFromKO(element.ownerDocument, path) !== element)
    throw new Error('Canonical source position unavailable');
  return path;
}

export async function toCFI(book: Book, original: string): Promise<CodecResult> {
  let phase: 'position' | 'chapter' = 'position';
  try {
    const { spine } = parseKO(original);
    const section = book.spine.get(spine) as Section | undefined;
    if (!section) throw new Error('Saved spine unavailable');
    phase = 'chapter';
    const root = await section.load(book.load.bind(book));
    phase = 'position';
    const element = elementFromKO(root.ownerDocument!, original);
    let cfi = section.cfiFromElement(element);
    if (cfi.endsWith('!/)')) cfi = cfi.slice(0, -1) + '0)';
    return { ok: true, cfi, original, precision: 'element' };
  } catch (error) {
    return { ok: false, original, reason: String(error), phase };
  }
}

export async function canonicalPosition(book: Book, spine: number, element: Element) {
  const ko = koFromElement(spine, element),
    result = await toCFI(book, ko);
  if (!result.ok) throw new Error(result.reason);
  const restored = await book.getRange(result.cfi),
    node = restored.startContainer;
  if ((node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) !== element)
    throw new Error('Canonical source/CFI round trip failed');
  return { ko, cfi: result.cfi };
}
export async function fromCFI(book: Book, cfi: string): Promise<string> {
  const range = await book.getRange(cfi);
  const node = range.startContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element) throw new Error('CFI has no element');
  const index = new EpubCFI(cfi).spinePos;
  return (await canonicalPosition(book, index, element)).ko;
}
