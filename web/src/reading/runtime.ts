import { liveQuery } from 'dexie';
import { sourceLimits } from './source';
import { Repository, type TurnPolicy } from './repository';
import { Replay } from './sync';
import { WorkerCoordinator } from './worker-client';
import { accountKey, refKey, sameAccount, type Account, type BookRef, type Checkpoint, type CoverLookup, type ReadingAccess, type OfflineChoice, type ReviewDecision, type ReadingActions, type ReadingBridge, type ReadingSnapshot, type StoredBook, type S } from './types';
import { readCover } from './cover';

const cacheETag = (value: string | null | undefined): string | undefined => value && /^(?:W\/)?"[\x21\x23-\x7e]{1,128}"$/.test(value) ? value : undefined;

export const emptySnapshot: ReadingSnapshot = { ready: false, resumeAccount: null, books: [], sync: 'idle', pendingCount: 0, notice: null, downloads: [], workerError: null, error: null };
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
  private stopObserving?: () => void;
  private view?: Awaited<ReturnType<Repository['readingView']>>;
  private timer?: ReturnType<typeof setTimeout>;
  private failures = 0;
  private jobs = new Map<AbortController, boolean>();
  private accountAccess = new AbortController();
  private coverJobs = new Set<string>();
  private quotaError = false;
  private snapshot: ReadingSnapshot = emptySnapshot;
  private error: string | null = null;
  constructor(private bridge: ReadingBridge, private changed: (snapshot: ReadingSnapshot) => void, private onExpired: (account: Account) => void, private lookupCover?: CoverLookup) {
    this.worker = new WorkerCoordinator(() => this.publishSnapshot());
    this.sync = new Replay(this.repo, bridge, () => this.publishSnapshot(), account => {
      if (this.access.kind === 'authenticated' && sameAccount(this.access.account, account)) {
        void this.setAccess({ kind: 'expired', account });
        this.onExpired(account);
      }
    });
  }
  async start(access: ReadingAccess) {
    window.addEventListener('online', this.foreground); document.addEventListener('visibilitychange', this.foreground);
    if (this.generation === 0) void this.setAccess(access);
    await this.repo.cleanupStages();
    await this.accessTail;
    if (this.disposed) return;
    await this.worker.start();
    await this.accessTail;
    if (!this.disposed) this.schedule(0);
  }
  setAccess(access: ReadingAccess) {
    if (this.generation && this.access === access) return this.accessTail;
    this.stopObserving?.();
    this.view = undefined;
    this.access = access; const version = ++this.generation; this.sync.stop(); this.error = null; this.quotaError = false;
    for (const [job, accountBound] of this.jobs) if (accountBound) job.abort();
    this.accountAccess.abort(); this.accountAccess = new AbortController();
    this.snapshot = emptySnapshot;
    this.projectionAccess = access;
    this.publishSnapshot();
    this.accessTail = this.accessTail.catch(() => undefined).then(async () => {
      if (this.disposed || version !== this.generation) return;
      await this.repo.setAccess(access);
      if (!this.disposed && version === this.generation) {
        this.appliedGeneration = version;
        await this.observeView(access, version);
        if (!this.disposed && version === this.generation) this.schedule(0);
      }
    }).catch(error => { if (!this.disposed && version === this.generation) { this.error = String(error); this.publishSnapshot(); } });
    return this.accessTail;
  }
  private foreground = () => { if (document.visibilityState === 'visible' || navigator.onLine) { this.failures = 0; this.schedule(0); void this.worker.connect().catch(error => { this.error = String(error); this.publishSnapshot(); }); } };
  private schedule(delay: number) { clearTimeout(this.timer); if (!this.disposed) this.timer = setTimeout(() => { void this.replay(); }, delay); }
  private requireReady() { if (this.disposed || this.appliedGeneration !== this.generation) throw new Error('Reading storage is not ready'); }
  private selectedAccount(): Account { if (this.access.kind !== 'authenticated' && this.access.kind !== 'offline') throw new Error('Authentication required'); return this.access.account; }
  private observeView(access: ReadingAccess, generation: number) {
    return new Promise<void>(resolve => {
      const subscription = liveQuery(() => this.repo.readingView(access)).subscribe({
        next: view => {
          if (!this.disposed && generation === this.generation) {
            this.view = view;
            this.publishSnapshot();
          }
          resolve();
        },
        error: error => {
          if (!this.disposed && generation === this.generation) {
            this.view = undefined;
            this.error = String(error);
            this.publishSnapshot();
          }
          resolve();
        },
      });
      // First Emission - Unsubscribing must also release callers waiting for the initial snapshot.
      this.stopObserving = () => { subscription.unsubscribe(); resolve(); };
    });
  }
  private publishSnapshot() {
    if (this.disposed) return;
    const view = this.view, authenticated = this.access.kind === 'authenticated';
    const pendingCount = view?.pendingCount ?? 0;
    this.snapshot = {
      books: view?.books ?? [], deviceCopies: view?.deviceCopies, resumeAccount: view?.resumeAccount ?? null,
      offlineRecords: view?.captures ?? [],
      ready: !!view, pendingCount,
      sync: this.quotaError ? 'quota-error' : !pendingCount ? 'idle' : view?.blocked ? 'blocked'
        : this.sync.status !== 'idle' ? this.sync.status : authenticated ? 'pending' : 'auth-required',
      notice: authenticated ? this.sync.notice : null, downloads: this.snapshot.downloads,
      workerError: this.worker.error, error: this.error,
    };
    this.changed(this.snapshot);
  }
  private async write<T>(action: () => Promise<T>, { signal, localError = false }: { signal?: AbortSignal; localError?: boolean } = {}) {
    this.requireReady();
    try { const result = await action(); this.quotaError = false; this.error = null; return result; }
    catch (error) {
      if (!localError && !signal?.aborted && (!signal || error instanceof Error && error.name === 'QuotaExceededError')) {
        this.quotaError = error instanceof Error && error.name === 'QuotaExceededError';
        this.error = this.quotaError ? 'Storage quota exceeded. No partial book/save was published.' : String(error);
      }
      throw error;
    } finally { this.publishSnapshot(); }
  }
  private async job<T>(external: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>, accountBound = true, deadlineMs = 1200000) {
    if (this.jobs.size >= 2) throw new Error('Two bounded reading operations are already active');
    const controller = new AbortController(), abort = () => controller.abort(external?.reason);
    external?.throwIfAborted(); external?.addEventListener('abort', abort, { once: true }); this.jobs.set(controller, accountBound);
    const timer = setTimeout(() => controller.abort(new Error('Reading operation deadline exceeded')), deadlineMs);
    try { return await action(controller.signal); } finally { clearTimeout(timer); this.jobs.delete(controller); external?.removeEventListener('abort', abort); }
  }
  async openServerBook(ref: Extract<BookRef, { kind: 'server' }>, external: AbortSignal, onStage?: (message: string) => void) {
    const account = this.selectedAccount(), generation = this.generation;
    if (!sameAccount(account, ref.account)) throw new Error('Book belongs to another account');
    if (this.appliedGeneration !== generation) await this.accessTail;
    const check = () => {
      external.throwIfAborted();
      if (generation !== this.generation) throw new DOMException('Book account changed', 'AbortError');
    };
    check();
    this.requireReady();
    const device = await this.repo.device(account);
    check();
    const policy: TurnPolicy = this.access.kind === 'offline' ? { mode: 'device' } : { mode: 'account', deviceId: device.id };
    let opened;
    if (policy.mode === 'device') {
      onStage?.('Opening offline copy…');
      opened = await this.repo.openOffline(ref);
    } else {
      opened = await this.ensureDownload(ref, external, onStage);
      check();
      onStage?.('Fetching your saved position…');
      const state = await this.bridge.getState(account, ref.documentId, AbortSignal.any([external, this.accountAccess.signal]));
      Object.assign(opened.row, await this.repo.applyServerState(ref, state, external));
    }
    check();
    await this.repo.keepSource(opened.row.sourceId!, external);
    return { ...opened, mode: policy.mode, deviceId: device.id,
      save: (checkpoint: Checkpoint, activity?: S['ActivityEvent']) => this.saveTurn(ref, policy, checkpoint, activity, external) };
  }
  private async ensureDownload(ref: Extract<BookRef, { kind: 'server' }>, external: AbortSignal, onStage?: (message: string) => void, pin?: Pick<StoredBook, 'title' | 'author'>) {
    const generation = this.generation, account = ref.account;
    const stageMessage = (message: string) => { if (!external.aborted) onStage?.(message); };
    const opened = await this.write(() => this.job(external, async signal => {
      const current = () => {
        signal.throwIfAborted();
        if (generation !== this.generation || this.access.kind !== 'authenticated' || !sameAccount(account, this.access.account)) throw new Error('Book account changed');
      };
      const previous = await this.repo.cachedOriginal(ref);
      const etag = cacheETag(previous?.etag);
      const fetchFile = async (validator?: string) => {
        current();
        stageMessage(validator ? 'Checking cached copy…' : 'Connecting to the server…');
        const response = await this.bridge.fetchFile(account, ref.documentId, signal, validator);
        try { current(); } catch (error) { await response.body?.cancel(); throw error; }
        return response;
      };
      let response = await fetchFile(etag);
      if (response.status === 304 && !response.redirected && etag && response.headers.get('ETag') === etag) {
        stageMessage('Opening cached copy…');
        try { return await this.repo.useCached(ref, previous!.sourceId!, etag, signal, pin); }
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
            }, () => { if (generation === this.generation) this.bridge.fileReadFailed?.(account); });
            try {
              if (length !== null && length !== stage.size) throw new Error('Incomplete EPUB download');
              this.snapshot = { ...this.snapshot, downloads: this.snapshot.downloads.map(item => item.ref === ref ? { ...item, receivedBytes: stage.size, preparing: true } : item) };
              this.changed(this.snapshot);
              const policy = await this.repo.validateStage(stage, signal, true, stageMessage);
              try {
                stageMessage('Saving a copy on this device…');
                await this.repo.publish(ref, stage, policy.manifest, previous?.title ?? policy.manifest.title, previous?.author ?? policy.manifest.author, null, undefined, signal, { etag: cacheETag(response.headers.get('ETag')), previousSource: previous?.sourceId, pin });
              } finally { policy.dispose(); }
            } finally { await this.repo.discardSource(stage.id); }
            return await this.repo.openSourceCopy(ref);
          } catch (error) {
            current();
            if (attempt || !(error instanceof Error) || error.name !== 'QuotaExceededError') throw error;
            await this.repo.freeServerCache(ref);
            response = await fetchFile();
          }
        }
      } finally {
        this.snapshot = { ...this.snapshot, downloads: this.snapshot.downloads.filter(item => item.ref !== ref) };
      }
    }), { signal: external, localError: !!pin });
    if (!opened.row.cover && opened.row.sourceId && generation === this.generation) void this.fillCover(ref, opened.row.sourceId);
    return opened;
  }
  cacheCover = async (ref: Extract<BookRef, { kind: 'server' }>, cover: Blob) => {
    if (this.disposed || this.appliedGeneration !== this.generation || this.access.kind !== 'authenticated' || !sameAccount(ref.account, this.access.account)) return;
    await this.repo.updateDownload(ref, cover, this.accountAccess.signal).catch(() => undefined);
  };
  async updateDownloadMetadata(ref: Extract<BookRef, { kind: 'server' }>, metadata: Pick<StoredBook, 'title' | 'author'>, cover?: Blob | null) {
    if (this.access.kind === 'authenticated' && sameAccount(ref.account, this.access.account)) await this.repo.updateDownload(ref, cover, this.accountAccess.signal, metadata);
  }
  private async fillCover(ref: Extract<BookRef, { kind: 'server' }>, sourceId: string) {
    if (this.disposed || this.access.kind !== 'authenticated' || !sameAccount(ref.account, this.access.account) || this.coverJobs.has(sourceId) || this.coverJobs.size >= 4) return;
    this.coverJobs.add(sourceId);
    const signal = AbortSignal.any([this.accountAccess.signal, AbortSignal.timeout(8_000)]);
    try {
      const cover = this.lookupCover?.(ref) ?? await readCover(await this.bridge.fetchCover(ref.account, ref.documentId, signal), signal);
      await this.repo.updateDownload(ref, cover, signal, undefined, sourceId);
    } catch { /* Artwork is optional; the source is already usable. */ }
    finally { this.coverJobs.delete(sourceId); }
  }
  async saveToDevice(ref: Extract<BookRef, { kind: 'server' }>, signal: AbortSignal, metadata: Pick<StoredBook, 'title' | 'author'>) {
    if (!sameAccount(ref.account, this.selectedAccount())) throw new Error('Account changed');
    await this.worker.ensureOfflineShell(signal);
    if (!sameAccount(ref.account, this.selectedAccount())) throw new Error('Account changed');
    if (this.access.kind === 'authenticated') {
      await this.ensureDownload(ref, signal, undefined, metadata);
      return;
    }
    await this.write(() => this.repo.retainCachedCopy(ref, signal), { signal, localError: true });
  }
  async removeFromDevice(ref: Extract<BookRef, { kind: 'server' }>, signal: AbortSignal) {
    const access = this.access;
    if ((access.kind !== 'authenticated' && access.kind !== 'offline') || !sameAccount(ref.account, access.account)) throw new Error('Account changed');
    await this.write(() => this.repo.removeFromDevice(ref, signal, access.kind), { signal, localError: true });
  }
  readerCacheSummary = () => { this.requireReady(); return this.repo.readerCacheSummary(); };
  clearReaderCache = () => { this.requireReady(); return this.repo.clearServerCache(); };
  async decideOffline(account: Account, choices: OfflineChoice[], decision: ReviewDecision) {
    if (this.access.kind !== 'authenticated' || !sameAccount(this.access.account, account)) throw new Error('Account changed');
    await this.write(() => this.repo.decideOffline(account, choices, decision));
    if (decision === 'upload') this.schedule(0);
  }
  private async saveTurn(ref: Extract<BookRef, { kind: 'server' }>, policy: TurnPolicy, checkpoint: Checkpoint, activity: S['ActivityEvent'] | undefined, lifetime: AbortSignal) {
    if (this.appliedGeneration !== this.generation) await this.accessTail;
    const current = () => !this.disposed && !lifetime.aborted
      && (this.access.kind === 'authenticated' || this.access.kind === 'offline') && sameAccount(this.access.account, ref.account);
    if (!current()) throw new DOMException('Reading access changed', 'AbortError');
    await this.write(() => this.repo.recordTurn(ref, policy, checkpoint, activity, current));
    if (policy.mode === 'account') this.schedule(0);
  }
  async replay() {
    const access = this.access;
    if (this.disposed || access.kind !== 'authenticated' || !navigator.onLine) return;
    await this.accessTail;
    if (this.disposed || this.access !== access || !navigator.onLine) return;
    await this.sync.run(access.account);
    const pending = await this.repo.pending(accountKey(access.account));
    if (this.access === access && navigator.onLine && pending.some(event => !event.rejected)) { this.failures = this.sync.status === 'retryable-error' ? this.failures + 1 : 0; this.schedule(Math.min(60000, 1000 * 2 ** Math.min(this.failures, 6)) + Math.random() * 500); }
  }
  applyUpdate = () => this.worker.apply();
  dispose() { this.disposed = true; this.accountAccess.abort(); this.sync.stop(); for (const [job] of this.jobs) job.abort(); clearTimeout(this.timer); this.stopObserving?.(); this.worker.dispose(); window.removeEventListener('online', this.foreground); document.removeEventListener('visibilitychange', this.foreground); void this.accessTail.finally(() => this.repo.db.close()); }
}
