import { sampleParagraphs } from './data';

export type SampleWord = { text: string; paragraph: number };
export type SamplePage = { start: number; end: number };
export const sampleWords: SampleWord[] = sampleParagraphs.flatMap((text, paragraph) =>
  text.split(/\s+/).map((word) => ({ text: word, paragraph })),
);

export function pageParagraphs(page: SamplePage) {
  const paragraphs: string[] = [];
  let previous = -1;
  for (const word of sampleWords.slice(page.start, page.end)) {
    if (word.paragraph !== previous) paragraphs.push(word.text);
    else paragraphs[paragraphs.length - 1] += ` ${word.text}`;
    previous = word.paragraph;
  }
  return paragraphs;
}

// Measurement Boundary — Only the empty aria-hidden surface is mutated; React owns the visible page.
export function measurePages(element: HTMLElement): SamplePage[] {
  if (element.clientHeight < 1 || element.clientWidth < 1) return [];
  function fits(start: number, end: number) {
    element.replaceChildren(
      ...pageParagraphs({ start, end }).map((text) => {
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        return paragraph;
      }),
    );
    return (
      element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth
    );
  }
  const pages: SamplePage[] = [];
  let start = 0;
  while (start < sampleWords.length) {
    let low = start + 1;
    let high = sampleWords.length;
    let end = low;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (fits(start, middle)) {
        end = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    pages.push({ start, end });
    start = end;
  }
  element.replaceChildren();
  return pages;
}
