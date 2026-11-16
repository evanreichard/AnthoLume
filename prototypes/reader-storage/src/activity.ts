export type Measurement = { forward: boolean; localOnly: boolean; pageWords: number; totalWords: number; currentWord: number; pageStartMs: number; nowMs: number };
export function measureActivity(input: Measurement) {
  if (!input.forward || input.localOnly) return undefined;
  const { pageWords, totalWords, currentWord, pageStartMs, nowMs } = input;
  if (![pageWords, totalWords, currentWord, pageStartMs, nowMs].every(Number.isFinite) || pageWords <= 0 || totalWords <= 0 || nowMs <= pageStartMs) return undefined;
  let elapsed = nowMs - pageStartMs;
  const wpm = pageWords / (elapsed / 60000);
  if (wpm >= 2000) return undefined;
  if (wpm < 100) elapsed = pageWords / 100 * 60000;
  const pages = Math.round(totalWords / pageWords);
  if (pages === 0) return undefined;
  return { duration: Math.round(elapsed / 1000), start_time: Math.round(pageStartMs / 1000), page: Math.round(currentWord * pages / totalWords), pages };
}
