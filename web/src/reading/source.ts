export const sourceLimits = Object.freeze({ diskBytes: 512 * 1024 * 1024, chunkBytes: 256 * 1024, centralBytes: 8 * 1024 * 1024, entries: 16384, expandedBytes: 2 * 1024 * 1024 * 1024, entryBytes: 32 * 1024 * 1024, textBytes: 4 * 1024 * 1024, cssBytes: 512 * 1024, ratio: 200, assetBytes: 32 * 1024 * 1024, chapterBytes: 8 * 1024 * 1024 });
export type Source = { kind: 'blob'; blob: Blob; size: number; digests?: string[] } | { kind: 'idb'; database: string; id: string; size: number; digests?: string[] };
export type SourceIntegrity = { sha256: string; protocolHash: string; digests: string[] };
export type ZipEntry = { name: string; offset: number; data?: number; local?: { nameLength: number; end: number }; size: number; expanded: number; method: number; flags: number; crc: number; digest?: string };
export type ZipIndex = { entries: ZipEntry[]; expanded: number };
export const blobSource = (blob: Blob): Source => ({ kind: 'blob', blob, size: blob.size });
export type IOStats = { reads: number; readBytes: number; maxRead: number; expanded: number; peakEntry: number };
export const sourceStats: IOStats = { reads: 0, readBytes: 0, maxRead: 0, expanded: 0, peakEntry: 0 };
export const sourceScheduler = { active: 0, peak: 0, queued: 0 };
const waiting: (() => void)[] = [];
async function slot(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted();
  let reserved = false;
  if (sourceScheduler.active >= 2) {
    if (waiting.length >= 16) throw new Error('Source request queue budget exceeded');
    await new Promise<void>((resolve, reject) => {
      const ready = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { const n = waiting.indexOf(ready); if (n >= 0) waiting.splice(n, 1); sourceScheduler.queued = waiting.length; reject(new DOMException('Queued source request cancelled', 'AbortError')); };
      waiting.push(ready); sourceScheduler.queued = waiting.length; signal?.addEventListener('abort', abort, { once: true });
    }); reserved = true;
  }
  if (!reserved) sourceScheduler.active++; sourceScheduler.peak = Math.max(sourceScheduler.peak, sourceScheduler.active);
  return () => { const next = waiting.shift(); sourceScheduler.queued = waiting.length; if (next) next(); else sourceScheduler.active--; };
}
export async function sourceTask<T>(source: Source, operation: 'hash' | 'index' | 'directory' | 'entry', entry?: ZipEntry, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!source.size || source.size > sourceLimits.diskBytes) throw new Error('Original source exceeds 512 MiB disk capacity');
  const release = await slot(signal);
  try { signal?.throwIfAborted(); } catch (error) { release(); throw error; }
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./source.worker.ts', import.meta.url), { type: 'module' }); } catch (error) { release(); reject(error); return; }
    let finished = false, releaseWorker: Worker | undefined, releaseBytes = 0;
    const finish = (error?: Error, result?: T) => { if (finished) return; finished = true; clearTimeout(timer); clearTimeout(idle); worker.terminate(); releaseWorker?.terminate(); release(); signal?.removeEventListener('abort', abort); if (error) reject(error); else resolve(result!); };
    const abort = () => finish(new DOMException('Source operation cancelled', 'AbortError'));
    const phase = operation === 'entry' ? 'unpacking an EPUB entry' : operation === 'hash' ? 'checking EPUB integrity' : 'indexing the EPUB';
    const timer = setTimeout(() => finish(new Error(`Time limit exceeded while ${phase}`)), 90_000);
    let idle: ReturnType<typeof setTimeout>;
    const watchProgress = () => {
      clearTimeout(idle);
      idle = setTimeout(() => finish(new Error(`No progress while ${phase}`)), 10_000);
    };
    watchProgress();
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('Source worker failed'));
    worker.onmessage = (event: MessageEvent<{ error?: string; result: T; stats: IOStats; release?: ArrayBuffer; releaseId?: number }>) => {
      if (event.data.release) {
        watchProgress();
        try {
          const bytes = event.data.release.byteLength;
          if (bytes > 8 * 1024 * 1024) throw new Error('Source buffer release window exceeded');
          if (releaseBytes + bytes > 8 * 1024 * 1024) { releaseWorker?.terminate(); releaseWorker = undefined; releaseBytes = 0; }
          releaseWorker ||= new Worker(new URL('./buffer-release.worker.ts', import.meta.url), { type: 'module' });
          releaseWorker.postMessage(event.data.release, [event.data.release]); releaseBytes += bytes;
          if (releaseBytes >= 8 * 1024 * 1024) { releaseWorker.terminate(); releaseWorker = undefined; releaseBytes = 0; }
          worker.postMessage({ released: event.data.releaseId });
        } catch (error) { finish(error instanceof Error ? error : new Error('Source buffer release failed')); }
        return;
      }
      const { stats } = event.data;
      if (stats) { sourceStats.reads += stats.reads; sourceStats.readBytes += stats.readBytes; sourceStats.maxRead = Math.max(sourceStats.maxRead, stats.maxRead); sourceStats.expanded += stats.expanded; sourceStats.peakEntry = Math.max(sourceStats.peakEntry, stats.peakEntry); }
      finish(event.data.error ? new Error(event.data.error) : undefined, event.data.result);
    };
    try { worker.postMessage({ source, operation, entry }); } catch (error) { finish(error instanceof Error ? error : new Error('Source worker could not start')); }
  });
}
export async function hashSource(source: Source, signal?: AbortSignal) { return sourceTask<SourceIntegrity>(source, 'hash', undefined, signal); }
export class ArchiveReader {
  readonly byName: Map<string, ZipEntry>;
  constructor(readonly source: Source, readonly index: ZipIndex, readonly signal?: AbortSignal) { this.byName = new Map(index.entries.map(e => [e.name, e])); }
  async bytes(name: string): Promise<Uint8Array<ArrayBuffer>> {
    const entry = this.byName.get(name); if (!entry) throw new Error('Missing indexed archive resource');
    const result = await sourceTask<{ bytes: Uint8Array<ArrayBuffer>; digest: string }>(this.source, 'entry', entry, this.signal);
    if (entry.digest && entry.digest !== result.digest) throw new Error('Archive entry integrity mismatch');
    entry.digest = result.digest; return result.bytes;
  }
}
