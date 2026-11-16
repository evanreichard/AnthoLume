import { EpubCFI } from 'epubjs';
import type Book from 'epubjs/types/book';
import type Section from 'epubjs/types/section';

export type CodecResult = { ok: true; cfi: string; original: string; precision: 'element' } | { ok: false; original: string; reason: string };

export function parseKO(original: string): { spine: number; steps: { tag: string; index: number }[] } {
  const match = /^\/body\/DocFragment\[([1-9]\d*)\]\/body((?:\/[a-zA-Z][\w-]*(?:\[[1-9]\d*\])?)*)(?:\/text\(\)(?:\[[1-9]\d*\])?)?(?:\.\d+)?$/.exec(original);
  if (!match) throw new Error('Unsupported KO path');
  return { spine: Number(match[1]) - 1, steps: (match[2] || '').split('/').filter(Boolean).map(step => {
    const part = /^([\w-]+)(?:\[(\d+)\])?$/.exec(step)!;
    return { tag: part[1]!.toLowerCase(), index: Number(part[2] || 1) };
  }) };
}

export function elementFromKO(doc: Document, original: string): Element {
  const { steps } = parseKO(original);
  const namespace = doc.documentElement.namespaceURI;
  const prefix = namespace ? 'ns:' : '';
  const xpath = `/${prefix}html/${prefix}body` + steps.map(({ tag, index }) => `/${prefix}${tag}[${index}]`).join('');
  const primary = doc.evaluate(xpath, doc, () => namespace, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
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
    let parent = current.parentElement;
    while (parent?.localName.toLowerCase() === 'a') parent = parent.parentElement;
    if (!parent) throw new Error('Element outside chapter body');
    const tag = current.localName.toLowerCase();
    const index = Array.from(parent.querySelectorAll(tag)).indexOf(current) + 1;
    if (!index) throw new Error('Element cannot be represented');
    suffix = `/${tag}[${index}]${suffix}`;
    current = parent;
  }
  const path = `/body/DocFragment[${spine + 1}]/body${suffix}`;
  // Conflicting Legacy Algorithms - Never publish a writer path that the primary reader resolves to a different element.
  if (elementFromKO(element.ownerDocument, path) !== element) throw new Error('Legacy writer/reader disagree; position unavailable');
  return path;
}

export async function toCFI(book: Book, original: string): Promise<CodecResult> {
  try {
    const { spine } = parseKO(original);
    const section = book.spine.get(spine) as Section | undefined;
    if (!section) throw new Error('Saved spine unavailable');
    const root = await section.load(book.load.bind(book));
    const element = elementFromKO(root.ownerDocument!, original);
    let cfi = section.cfiFromElement(element);
    if (cfi.endsWith('!/)')) cfi = cfi.slice(0, -1) + '0)';
    return { ok: true, cfi, original, precision: 'element' };
  } catch (error) { return { ok: false, original, reason: String(error) }; }
}

export async function fromCFI(book: Book, cfi: string): Promise<string> {
  const range = await book.getRange(cfi);
  const node = range.startContainer;
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  if (!element) throw new Error('CFI has no element');
  const index = new EpubCFI(cfi).spinePos;
  return koFromElement(index, element);
}
