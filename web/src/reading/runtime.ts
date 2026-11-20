import { liveQuery } from 'dexie';
import { sourceLimits } from './source';
import { Repository } from './repository';
import { Replay } from './sync';
import { WorkerCoordinator } from './worker-client';
import { accountKey, refKey, sameAccount, type Account, type BookRef, type Checkpoint, type ReadingAccess, type ReadingActions, type ReadingBridge, type ReadingSnapshot, type S } from './types';
import { validState } from './protocol';
import type { CapturedActivity } from './activity';

const cacheETag = (value: string | null | undefined): string | undefined => value && /^(?:W\/)?"[\x21\x23-\x7e]{1,128}"$/.test(value) ? value : undefined;

export const emptySnapshot: ReadingSnapshot = { ready: false, resumeAccount: null, books: [], sync: 'idle', pendingCount: 0, notice: null, downloads: [], update: 'idle', error: null };
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
    this.subscription = liveQuery(() => Promise.all([this.repo.db.books.toArray(), this.repo.db.events.toArray(), this.repo.db.access.toArray(), this.repo.db.meta.toArray()])).subscribe({ next: () => { void this.refresh(); }, error: error => { this.error = String(error); void this.refresh(); } });
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
    if (this.generation && this.access === access && this.appliedGeneration === this.generation) return this.accessTail;
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
  private requireReady() { if (this.disposed || this.appliedGeneration !== this.generation) throw new Error('Reading storage is not ready'); }
  private selectedAccount(): Account { if (this.access.kind !== 'authenticated') throw new Error('Authentication required'); return this.access.account; }
  async refresh() {
    if (this.disposed) return;
    const serial = ++this.refreshSerial, access = this.access;
    try {
      const [books, resumeAccount, pending] = await Promise.all([this.repo.projection(access), this.repo.resume(), this.repo.pending()]);
      if (serial !== this.refreshSerial || this.disposed) return;
      const scope = 'account' in access && access.kind !== 'logout' ? accountKey(access.account) : null;
      const visible = pending.filter(e => e.scope === scope);
      this.projectionAccess = access;
      this.snapshot = { ready: this.appliedGeneration === this.generation, resumeAccount, books: books.map(({ ref, title, author, cover, availability, checkpoint, addedAt, lastReadAt }) => ({ ref, title, author, cover, availability, checkpoint, addedAt, lastReadAt })), sync: this.quotaError ? 'quota-error' : !visible.length ? 'idle' : this.sync.status === 'idle' ? access.kind === 'authenticated' ? 'pending' : 'auth-required' : this.sync.status, pendingCount: visible.length, notice: access.kind === 'authenticated' ? this.sync.notice : null, downloads: this.snapshot.downloads, update: this.worker.update, error: this.error || this.worker.error || null };
      this.changed(this.snapshot);
    } catch (error) { if (!this.disposed) { this.snapshot = { ...this.snapshot, ready: false, error: String(error) }; this.changed(this.snapshot); } }
  }
  private async write<T>(action: () => Promise<T>, readerOpen?: AbortSignal) {
    this.requireReady();
    try { const result = await action(); this.quotaError = false; this.error = null; return result; }
    catch (error) {
      if (!readerOpen?.aborted && (!readerOpen || error instanceof Error && error.name === 'QuotaExceededError')) {
        this.quotaError = error instanceof Error && error.name === 'QuotaExceededError';
        this.error = this.quotaError ? 'Storage quota exceeded. No partial book/save was published.' : String(error);
      }
      throw error;
    } finally { await this.refresh(); }
  }
  private async job<T>(external: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>, accountBound = true, deadlineMs = 1200000) {
    if (this.jobs.size >= 2) throw new Error('Two bounded reading operations are already active');
    const controller = new AbortController(), abort = () => controller.abort(external?.reason);
    external?.throwIfAborted(); external?.addEventListener('abort', abort, { once: true }); this.jobs.set(controller, accountBound);
    const timer = setTimeout(() => controller.abort(new Error('Reading operation deadline exceeded')), deadlineMs);
    try { return await action(controller.signal); } finally { clearTimeout(timer); this.jobs.delete(controller); external?.removeEventListener('abort', abort); }
  }
  async openServerBook(ref: Extract<BookRef, { kind: 'server' }>, external: AbortSignal, onStage?: (message: string) => void) {
    const stageMessage = (message: string) => { if (!external.aborted) onStage?.(message); };
    const account = this.selectedAccount(), generation = this.generation, key = refKey(ref);
    if (!sameAccount(account, ref.account)) throw new Error('Book belongs to another account');
    if (this.appliedGeneration !== generation) await this.accessTail;
    external.throwIfAborted();
    if (generation !== this.generation) throw new DOMException('Book account changed', 'AbortError');
    const opened = await this.write(() => this.job(external, async signal => {
      const current = () => {
        signal.throwIfAborted();
        if (generation !== this.generation || this.access.kind !== 'authenticated' || !sameAccount(account, this.access.account)) throw new Error('Book account changed');
      };
      const previous = await this.repo.db.books.get(key);
      const etag = previous?.sourceId && previous.availability === 'available' ? cacheETag(previous.etag) : undefined;
      const fetchFile = async (validator?: string) => {
        current();
        stageMessage(validator ? 'Checking cached copy…' : 'Connecting to the server…');
        const response = await this.bridge.fetchFile(account, ref.documentId, signal, validator);
        try { current(); } catch (error) { await response.body?.cancel(); throw error; }
        return response;
      };
      const getState = async () => {
        stageMessage('Fetching your saved position…');
        const state = await this.bridge.getState(account, ref.documentId, signal);
        current();
        if (!validState(state, ref.documentId)) throw new Error('Invalid server reading state');
        return state;
      };
      let response = await fetchFile(etag);
      if (response.status === 304 && !response.redirected && etag && response.headers.get('ETag') === etag) {
        const state = await getState();
        stageMessage('Opening cached copy…');
        try { return await this.repo.useCached(ref, previous!.sourceId!, etag, state, signal); }
        catch { current(); response = await fetchFile(); }
      }
      try {
        for (let attempt = 0; ; attempt++) {
          if (response.status !== 200 || response.redirected || !/^(?:application\/epub\+zip|application\/octet-stream)$/.test(response.headers.get('Content-Type')?.split(';')[0]?.trim() ?? '') || !response.body) {
            await response.body?.cancel();
            throw new Error('Could not load EPUB from the server');
          }
          const rawLength = response.headers.get('Content-Length');
          const length = rawLength && /^\d+$/.test(rawLength) ? Number(rawLength) : null;
          if (length !== null && length > sourceLimits.diskBytes) { await response.body.cancel(); throw new Error('EPUB exceeds compressed budget'); }
          stageMessage('Downloading EPUB…');
          this.snapshot = { ...this.snapshot, downloads: [...this.snapshot.downloads.filter(item => item.ref !== ref), { ref, receivedBytes: 0, totalBytes: length }] };
          this.changed(this.snapshot);
          try {
            const stage = await this.repo.stageStream(ref, response.body, signal, receivedBytes => {
              this.snapshot = { ...this.snapshot, downloads: this.snapshot.downloads.map(item => item.ref === ref ? { ...item, receivedBytes } : item) };
              this.changed(this.snapshot);
            });
            try {
              if (length !== null && length !== stage.size) throw new Error('Incomplete EPUB download');
              this.snapshot = { ...this.snapshot, downloads: this.snapshot.downloads.map(item => item.ref === ref ? { ...item, receivedBytes: stage.size, preparing: true } : item) };
              this.changed(this.snapshot);
              const policy = await this.repo.validateStage(stage, signal, true, stageMessage);
              try {
                const state = await getState();
                stageMessage('Saving a copy on this device…');
                await this.repo.publish(ref, stage, policy.manifest, previous?.title ?? policy.manifest.title, previous?.author ?? policy.manifest.author, null, state, signal, { etag: cacheETag(response.headers.get('ETag')) });
              } finally { policy.dispose(); }
            } finally { await this.repo.discardSource(stage.id); }
            return await this.repo.open(ref);
          } catch (error) {
            current();
            if (attempt || !(error instanceof Error) || error.name !== 'QuotaExceededError') throw error;
            await this.repo.freeServerCache();
            response = await fetchFile();
          }
        }
      } finally {
        this.snapshot = { ...this.snapshot, downloads: this.snapshot.downloads.filter(item => item.ref !== ref) };
      }
    }), external);
    external.throwIfAborted();
    if (generation !== this.generation || !opened.row.sourceId) throw new Error('Book account or source changed');
    await this.repo.keepSource(opened.row.sourceId, external);
    return opened;
  }
  readerCacheSummary = () => { this.requireReady(); return this.repo.readerCacheSummary(); };
  clearReaderCache = () => { this.requireReady(); return this.repo.clearServerCache(); };
  exportLocal = (ref: Extract<BookRef, { kind: 'local' }>) => this.repo.exportLocal(ref);
  async save(ref: BookRef, checkpoint: Checkpoint, activity?: S['ActivityEvent']) { await this.write(() => this.repo.save(ref, checkpoint, activity)); this.schedule(0); }
  async credit(ref: BookRef, event: S['ActivityEvent'], measured?: CapturedActivity) { await this.write(() => this.repo.credit(ref, event, measured)); this.schedule(0); }
  async replay() {
    if (this.disposed || this.access.kind !== 'authenticated') return;
    await this.accessTail;
    await this.sync.run(this.access.account);
    const pending = await this.repo.pending(accountKey(this.access.kind === 'authenticated' ? this.access.account : { origin: location.origin, userId: '' }));
    await this.refresh();
    if (pending.length) { this.failures = this.sync.status === 'retryable-error' ? this.failures + 1 : 0; this.schedule(Math.min(60000, 1000 * 2 ** Math.min(this.failures, 6)) + Math.random() * 500); }
  }
  applyUpdate = async () => { await this.worker.apply(); await this.refresh(); };
  dispose() { this.disposed = true; this.sync.stop(); for (const [job] of this.jobs) job.abort(); clearTimeout(this.timer); this.subscription?.unsubscribe(); this.worker.dispose(); window.removeEventListener('online', this.foreground); document.removeEventListener('visibilitychange', this.foreground); void this.accessTail.finally(() => this.repo.db.close()); }
}
