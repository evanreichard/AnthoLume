import { EpubCFI } from 'epubjs';

type Segment = { steps: object[]; terminal: unknown };
type Parsed = { base: Segment; path: Segment };
type RangeCFI = { parse(value: string): Parsed; equalStep(a: object, b: object): boolean; segmentString(segment: Segment): string };
// Legacy Measurement Seam - Preserve the original combined-CFI visible text range; a collapsed image-only end CFI can have no standalone Range.
export function legacyCFIRange(a: string, b: string): string {
  const codec = new EpubCFI() as unknown as RangeCFI, start = codec.parse(a), end = codec.parse(b);
  const common: Segment = { steps: [], terminal: null }, first = { ...start.path, steps: [...start.path.steps] }, last = { ...end.path, steps: [...end.path.steps] };
  for (let i = 0; i < first.steps.length; i++) {
    if (!last.steps[i] || !codec.equalStep(first.steps[i]!, last.steps[i]!)) break;
    if (i === first.steps.length - 1) { if (first.terminal === last.terminal) common.steps.push(first.steps[i]!); }
    else common.steps.push(first.steps[i]!);
  }
  first.steps = first.steps.slice(common.steps.length); last.steps = last.steps.slice(common.steps.length);
  return `epubcfi(${codec.segmentString(start.base)}!${codec.segmentString(common)},${codec.segmentString(first)},${codec.segmentString(last)})`;
}
