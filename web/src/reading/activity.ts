import type { S } from './types';

export type Measurement = {
  forward: boolean;
  localOnly: boolean;
  pageWords: number;
  totalWords: number;
  currentWord: number;
  pageStartMs: number;
  nowMs: number;
};
export function measureActivity(input: Measurement) {
  if (!input.forward || input.localOnly) return undefined;
  const { pageWords, totalWords, currentWord, pageStartMs, nowMs } = input;
  if (
    ![pageWords, totalWords, currentWord, pageStartMs, nowMs].every(Number.isFinite) ||
    pageWords <= 0 ||
    totalWords <= 0 ||
    nowMs <= pageStartMs
  )
    return undefined;
  let elapsed = nowMs - pageStartMs;
  const wpm = pageWords / (elapsed / 60000);
  if (wpm >= 2000) return undefined;
  if (wpm < 100) elapsed = (pageWords / 100) * 60000;
  const pages = Math.round(totalWords / pageWords);
  if (pages === 0) return undefined;
  return {
    duration: Math.round(elapsed / 1000),
    start_time: Math.round(pageStartMs / 1000),
    page: Math.round((currentWord * pages) / totalWords),
    pages,
  };
}
export type CapturedActivity = NonNullable<ReturnType<typeof measureActivity>> & {
  intervalId: string;
  startMs: number;
  endMs: number;
};
export function activityEvent(documentId: string, deviceId: string, measured: CapturedActivity): S['ActivityEvent'] {
  return {
    event_id: measured.intervalId,
    document_id: documentId,
    device_id: deviceId,
    start_time: new Date(measured.start_time * 1000).toISOString(),
    duration: measured.duration,
    start_fraction: measured.page / measured.pages,
    end_fraction: Math.min(1, (measured.page + 1) / measured.pages),
  };
}
