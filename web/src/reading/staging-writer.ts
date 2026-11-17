export const stagingWorkers = { active: 0, peak: 0, peakWindow: 0, maxWindow: 8 * 1024 * 1024 };
type Reply = { kind: 'ready' | 'written' | 'reserve' | 'error'; id?: number; key?: string; received?: number; chunkNumber?: number; buffered?: number; error?: { name: string; message: string } };
export class StagingWriter {
  private worker: Worker;
  private pending?: { resolve(value: Reply): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
  private dead = false;
  private bytes = 0;
  readonly ready: Promise<Reply>;
  constructor(database: string, sourceId: string, received: number, chunkNumber: number, private reserve: (key: string) => Promise<unknown>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (stagingWorkers.active >= 2) throw new Error('Two bounded staging writers are already active');
    this.worker = new Worker(new URL('./staging.worker.ts', import.meta.url), { type: 'module' }); stagingWorkers.active++; stagingWorkers.peak = Math.max(stagingWorkers.peak, stagingWorkers.active);
    this.worker.onmessage = event => { if (this.dead) return; const reply = event.data as Reply; if (reply.kind === 'reserve') { void this.reserve(reply.key!).then(() => { if (!this.dead) this.worker.postMessage({ kind: 'grant', id: reply.id }); }, error => { if (!this.dead) this.worker.postMessage({ kind: 'grant', id: reply.id, error: { name: error.name || 'Error', message: 'Staged chunk reservation failed' } }); }); return; } const pending = this.pending; this.pending = undefined; if (!pending) return; clearTimeout(pending.timer); if (reply.kind === 'error') { const error = new Error(reply.error?.message); error.name = reply.error?.name || 'Error'; pending.reject(error); } else pending.resolve(reply); };
    this.worker.onerror = () => this.dispose(new Error('Staging worker failed'));
    const abort = () => this.dispose(new DOMException('Staging cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true }); this.removeAbort = () => signal?.removeEventListener('abort', abort);
    this.ready = this.wait(); try { this.worker.postMessage({ kind: 'init', database, sourceId, received, chunkNumber }); } catch (error) { this.dispose(error instanceof Error ? error : new Error('Staging worker could not start')); }
  }
  private removeAbort: () => void;
  private wait(): Promise<Reply> { return new Promise((resolve, reject) => { if (this.dead) { reject(new Error('Staging worker disposed')); return; } this.pending = { resolve, reject, timer: setTimeout(() => this.dispose(new Error('Staging write deadline exceeded')), 30000) }; }); }
  async write(bytes: Uint8Array<ArrayBuffer>, final = false) { await this.ready; if (bytes.length > this.remaining) throw new Error('Staging worker window budget exceeded'); const result = this.wait(); this.bytes += bytes.length; stagingWorkers.peakWindow = Math.max(stagingWorkers.peakWindow, this.bytes); try { this.worker.postMessage({ kind: 'input', bytes: bytes.buffer, offset: bytes.byteOffset, length: bytes.byteLength, final }, [bytes.buffer]); } catch (error) { this.dispose(error instanceof Error ? error : new Error('Staging transfer failed')); } return result; }
  get remaining() { return stagingWorkers.maxWindow - this.bytes; }
  dispose(error = new Error('Staging writer disposed')) { if (this.dead) return; this.dead = true; this.worker.terminate(); stagingWorkers.active--; this.removeAbort?.(); if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; } }
}
