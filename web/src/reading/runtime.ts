import { liveQuery } from 'dexie';
import { boundedStream } from './archive';
import { sourceLimits } from './source';
import { rasterPixels } from './media-budget';
import { Repository } from './repository';
import { Replay } from './sync';
import { WorkerCoordinator } from './worker-client';
import { accountKey, sameAccount, type Account, type BookRef, type Checkpoint, type Conflict, type ReadingAccess, type ReadingActions, type ReadingBridge, type ReadingSnapshot, type S } from './types';
import { validState } from './protocol';
import type { CapturedActivity } from './activity';

export const emptySnapshot: ReadingSnapshot = { ready: false, resumeAccount: null, books: [], sync: 'idle', pendingCount: 0, conflicts: [], downloads: [], update: 'idle', error: null };
export class ReadingRuntime implements ReadingActions {
  readonly repo = new Repository();
  readonly worker: WorkerCoordinator;
  private sync: Replay;
  private disposed = false;
  private generation = 0;
  private appliedGeneration = 0;
  private access: ReadingAccess = { kind: 'loading' };
  projectionAccess: ReadingAccess = { kind: 'loading' };
  private accessTail: Promise<void> = Promise.resolve();
  private subscription?: { unsubscribe(): void };
  private timer?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private jobs = new Map<AbortController, boolean>();
  private quotaError = false;
  private downloading = new Map<string, Promise<BookRef>>();
  private snapshot: ReadingSnapshot = emptySnapshot;
  private error: string | null = null;
  private refreshSerial = 0;
  constructor(private bridge: ReadingBridge, private changed: (snapshot: ReadingSnapshot) => void, private onExpired: (account: Account) => void) {
    this.worker = new WorkerCoordinator(() => { void this.refresh(); });
    this.sync = new Replay(this.repo, bridge, () => { void this.refresh(); }, account => {
      if (this.access.kind === 'authenticated' && sameAccount(this.access.account, account)) { this.access = { kind: 'expired', account }; this.onExpired(account); }
    });
  }
  async start(access: ReadingAccess) {
    this.subscription = liveQuery(() => Promise.all([this.repo.db.books.toArray(), this.repo.db.events.toArray(), this.repo.db.decisions.toArray(), this.repo.db.conflicts.toArray(), this.repo.db.access.toArray(), this.repo.db.meta.toArray()])).subscribe({ next: () => { void this.refresh(); }, error: error => { this.error = String(error); void this.refresh(); } });
    window.addEventListener('online', this.foreground); document.addEventListener('visibilitychange', this.foreground);
    if (this.generation === 0) void this.setAccess(access);
    await this.repo.cleanupStages();
    await this.accessTail;
    if (this.disposed) return;
    await this.worker.start();
    await this.accessTail;
    if (!this.disposed) { await this.refresh(); this.schedule(0); }
  }
  setAccess(access: ReadingAccess) {
    this.access = access; const version = ++this.generation; this.sync.stop(); this.error = null; this.quotaError = false;
    for (const [job, accountBound] of this.jobs) if (accountBound) job.abort();
    this.snapshot = { ...this.snapshot, downloads: [] };
    void this.refresh();
    this.accessTail = this.accessTail.catch(() => undefined).then(async () => {
      if (this.disposed || version !== this.generation) return;
      await this.repo.setAccess(access);
      if (!this.disposed && version === this.generation) { this.appliedGeneration = version; await this.refresh(); this.schedule(0); }
    }).catch(error => { if (!this.disposed && version === this.generation) { this.error = String(error); void this.refresh(); } });
    return this.accessTail;
  }
  private foreground = () => { if (document.visibilityState === 'visible' || navigator.onLine) { this.failures = 0; this.schedule(0); void this.worker.connect().catch(error => { this.error = String(error); void this.refresh(); }); } };
  private schedule(delay: number) { clearTimeout(this.timer); if (!this.disposed) this.timer = setTimeout(() => { void this.replay(); }, delay); }
  private requireReady() { if (this.disposed || !this.worker.ready || this.appliedGeneration !== this.generation) throw new Error('Compatible offline shell/retirement is not ready; retry recovery before writing'); }
  private selectedAccount(): Account { if (this.access.kind !== 'authenticated') throw new Error('Authentication required'); return this.access.account; }
  async refresh() {
    if (this.disposed) return;
    const serial = ++this.refreshSerial, access = this.access;
    try {
      const [books, resumeAccount, pending, conflicts] = await Promise.all([this.repo.projection(access), this.repo.resume(), this.repo.pending(), this.repo.db.conflicts.toArray()]);
      if (serial !== this.refreshSerial || this.disposed) return;
      const scope = 'account' in access && access.kind !== 'logout' ? accountKey(access.account) : null;
      const visible = pending.filter(e => e.scope === scope), visibleConflicts = conflicts.filter(c => c.scope === scope);
      this.projectionAccess = access;
      this.snapshot = { ready: this.worker.ready && this.appliedGeneration === this.generation, resumeAccount, books: books.map(({ ref, title, author, cover, availability, checkpoint }) => ({ ref, title, author, cover, availability, checkpoint })), sync: this.quotaError ? 'quota-error' : !visible.length ? 'idle' : this.sync.status === 'idle' ? visibleConflicts.length ? 'conflict' : access.kind === 'authenticated' ? 'pending' : 'auth-required' : this.sync.status, pendingCount: visible.length, conflicts: visibleConflicts.filter(c => c.server !== null).map(({ eventId, ref, local, server }) => ({ eventId, ref, local, server: server! })), downloads: this.snapshot.downloads, update: this.worker.update, error: this.error || this.worker.error || visibleConflicts.find(c => c.server === null)?.refreshError || null };
      this.changed(this.snapshot);
    } catch (error) { if (!this.disposed) { this.snapshot = { ...this.snapshot, ready: false, error: String(error) }; this.changed(this.snapshot); } }
  }
  private async write<T>(action: () => Promise<T>) {
    this.requireReady(); this.worker.busy++;
    try { const result = await action(); this.quotaError = false; this.error = null; return result; } catch (error) { this.quotaError = error instanceof Error && error.name === 'QuotaExceededError'; this.error = this.quotaError ? 'Storage quota exceeded. No partial book/save was published.' : String(error); throw error; }
    finally { this.worker.busy--; await this.refresh(); }
  }
  private async job<T>(external: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>, accountBound = true, deadlineMs = 1200000) {
    if (this.jobs.size >= 2) throw new Error('Two bounded reading operations are already active');
    const controller = new AbortController(), abort = () => controller.abort(external?.reason);
    external?.throwIfAborted(); external?.addEventListener('abort', abort, { once: true }); this.jobs.set(controller, accountBound);
    const timer = setTimeout(() => controller.abort(new Error('Reading operation deadline exceeded')), deadlineMs);
    try { return await action(controller.signal); } finally { clearTimeout(timer); this.jobs.delete(controller); external?.removeEventListener('abort', abort); }
  }
  async importLocal(file: File, external?: AbortSignal): Promise<BookRef> {
    return this.write(() => this.job(external, async signal => {
      const ref: BookRef = { kind: 'local', localId: crypto.randomUUID() }, stage = await this.repo.stageBlob(ref, file, signal);
      try { const policy = await this.repo.validateStage(stage, signal); await this.repo.publish(ref, stage, policy.manifest, policy.manifest.title || file.name, policy.manifest.author, null, undefined, signal); policy.dispose(); return ref; }
      finally { await this.repo.discardSource(stage.id); }
    }, false));
  }
  async download(document: S['Document'], external?: AbortSignal): Promise<BookRef> {
    const account = this.selectedAccount(), key = JSON.stringify([accountKey(account), document.id]);
    const previous = this.downloading.get(key); if (previous) return previous;
    const ref: BookRef = { kind: 'server', account, documentId: document.id }, generation = this.generation;
    const work = this.write(() => this.job(external, async signal => {
      const response = await this.bridge.fetchFile(account, document.id, signal);
      signal.throwIfAborted();
      if (generation !== this.generation) { await response.body?.cancel(); throw new Error('Download account changed'); }
      if (response.status !== 200 || response.redirected || !(response.headers.get('Content-Type') || '').split(';')[0]?.match(/^(?:application\/epub\+zip|application\/octet-stream)$/) || !response.body) { await response.body?.cancel(); throw new Error('Original EPUB download failed or has unsupported MIME'); }
      const rawLength = response.headers.get('Content-Length'), length = rawLength && /^\d+$/.test(rawLength) ? Number(rawLength) : null;
      if (length !== null && length > sourceLimits.diskBytes) { await response.body.cancel(); throw new Error('EPUB exceeds compressed budget'); }
      this.snapshot = { ...this.snapshot, downloads: [...this.snapshot.downloads, { ref, receivedBytes: 0, totalBytes: length }] }; this.changed(this.snapshot);
      const stage = await this.repo.stageStream(ref, response.body, signal, receivedBytes => { this.snapshot = { ...this.snapshot, downloads: this.snapshot.downloads.map(d => d.ref === ref ? { ...d, receivedBytes } : d) }; this.changed(this.snapshot); });
      try {
      if (length !== null && length !== stage.size) throw new Error('Incomplete EPUB download');
      const policy = await this.repo.validateStage(stage, signal);
      const state = await this.bridge.getState(account, document.id, signal);
      if (!validState(state, document.id)) throw new Error('Invalid server reading state');
      let cover: Blob | null = null;
      if (document.cover_available) {
        try {
          const response = await this.bridge.fetchCover(account, document.id, signal);
          if (response.status === 200 && !response.redirected && /^image\/(?:png|jpeg|gif|webp)$/.test(response.headers.get('Content-Type') || '') && response.body) {
            const bytes = await boundedStream(response.body, signal, undefined, 2 * 1024 * 1024, 10000);
            rasterPixels(response.headers.get('Content-Type')!, new Uint8Array(bytes));
            cover = new Blob([bytes], { type: response.headers.get('Content-Type')! });
          } else await response.body?.cancel();
        } catch { signal.throwIfAborted(); }
      }
      signal.throwIfAborted(); if (generation !== this.generation || this.access.kind !== 'authenticated' || !sameAccount(account, this.access.account)) throw new Error('Download account changed');
      await this.repo.publish(ref, stage, policy.manifest, document.title, document.author, cover, state, signal); policy.dispose(); return ref;
      } finally { await this.repo.discardSource(stage.id); }
    })).finally(() => { this.downloading.delete(key); this.snapshot = { ...this.snapshot, downloads: this.snapshot.downloads.filter(d => d.ref !== ref) }; void this.refresh(); });
    this.downloading.set(key, work); return work;
  }
  removeBook = (ref: BookRef) => this.write(() => this.repo.remove(ref));
  async save(ref: BookRef, checkpoint: Checkpoint, activity?: S['ActivityEvent']) { await this.write(() => this.repo.save(ref, checkpoint, activity)); this.schedule(0); }
  async credit(ref: BookRef, event: S['ActivityEvent'], measured?: CapturedActivity) { await this.write(() => this.repo.credit(ref, event, measured)); this.schedule(0); }
  async replay() {
    if (this.disposed || !this.worker.ready || this.access.kind !== 'authenticated') return;
    await this.accessTail;
    await this.sync.run(this.access.account);
    const pending = await this.repo.pending(accountKey(this.access.kind === 'authenticated' ? this.access.account : { origin: location.origin, userId: '' }));
    await this.refresh();
    if (pending.length) { this.failures = this.sync.status === 'retryable-error' ? this.failures + 1 : 0; this.schedule(Math.min(60000, 1000 * 2 ** Math.min(this.failures, 6)) + Math.random() * 500); }
  }
  applyUpdate = async () => { await this.worker.apply(); await this.refresh(); };
  async refreshConflict(eventId: string): Promise<Conflict> {
    const account = this.selectedAccount(), generation = this.generation, scope = accountKey(account);
    const conflict = await this.repo.db.conflicts.get(eventId), access = await this.repo.db.access.get(scope);
    if (!conflict || conflict.scope !== scope || conflict.ref.kind !== 'server' || !access) throw new Error('Conflict not accessible');
    const state = await this.job(undefined, signal => this.bridge.getState(account, conflict.ref.kind === 'server' ? conflict.ref.documentId : '', signal), true, 3000);
    if (generation !== this.generation) throw new Error('Account changed');
    const result = await this.repo.refreshConflict(eventId, state, access.epoch); await this.refresh(); return result;
  }
  resolveConflict = async (eventId: string, choice: 'local' | 'server', observedRevision: string) => {
    this.selectedAccount();
    const fresh = await this.refreshConflict(eventId);
    if (fresh.server.revision !== observedRevision) throw new Error('Server changed again; review the refreshed conflict before choosing');
    await this.write(() => this.repo.resolve(eventId, choice, observedRevision)); this.schedule(0);
  };
  dispose() { this.disposed = true; this.sync.stop(); for (const [job] of this.jobs) job.abort(); clearTimeout(this.timer); this.subscription?.unsubscribe(); this.worker.dispose(); window.removeEventListener('online', this.foreground); document.removeEventListener('visibilitychange', this.foreground); void this.accessTail.finally(() => this.repo.db.close()); }
}
