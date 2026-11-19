import { accountKey, ReadingHTTPError, type Account, type ReadingBridge, type SyncStatus } from './types';
import { Repository, type EventRow } from './repository';
import { validDevice, validProblem, validState } from './protocol';

export class Replay {
  private running: Promise<void> | null = null;
  private owner = crypto.randomUUID();
  private abort?: AbortController;
  status: SyncStatus = 'idle';
  constructor(private repo: Repository, private bridge: ReadingBridge, private changed: () => void, private expired: (account: Account) => void) {}
  stop() { this.abort?.abort(); }
  run(account: Account): Promise<void> {
    if (this.running) return this.running;
    this.running = this.perform(account).finally(() => { this.running = null; this.changed(); });
    return this.running;
  }
  private async perform(account: Account) {
    const lease = await this.repo.claim(account, this.owner);
    if (!lease) return;
    this.status = 'syncing'; this.changed();
    const controller = this.abort = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
    const current = async () => { controller.signal.throwIfAborted(); if (!await this.repo.leaseCurrent(lease)) throw new Error('Access epoch or lease changed'); };
    let detailBudgetMs = 3000;
    const refreshConflict = async (event: EventRow, revision: string) => {
      await this.repo.recordConflict(lease, event, null, revision);
      this.status = 'conflict'; this.changed();
      const refresh = new AbortController(), abort = () => refresh.abort(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const started = performance.now();
      try {
        if (detailBudgetMs <= 0) throw new Error('Conflict detail budget exhausted');
        const state = await Promise.race([
          this.bridge.getState(account, event.payload.document_id, refresh.signal),
          new Promise<never>((_, reject) => { deadline = setTimeout(() => { refresh.abort(); reject(new Error('Conflict detail deadline exceeded')); }, detailBudgetMs); }),
        ]);
        await current();
        if (!validState(state, event.payload.document_id)) throw new Error('Invalid conflict state');
        await this.repo.recordConflict(lease, event, state);
      } catch (error) {
        await current();
        if (error instanceof ReadingHTTPError && error.status === 401 && validProblem(error.problem, 401) && error.problem.code === 'unauthenticated') throw error;
        await this.repo.recordConflict(lease, event, null, revision, 'Progress conflict needs fresh server details. Retry synchronization to refresh; activity can still synchronize.');
      } finally { detailBudgetMs -= performance.now() - started; clearTimeout(deadline); controller.signal.removeEventListener('abort', abort); refresh.abort(); }
    };
    try {
      const device = await this.repo.device(account);
      await current();
      const registered = await this.bridge.registerDevice(account, device, controller.signal);
      await current();
      if (!validDevice(registered, device.id)) throw new Error('Device registration was not exact');
      for (const id of lease.ids) {
        await current();
        const event = await this.repo.db.events.get(id);
        if (!event || event.scope !== accountKey(account)) throw new Error('Immutable event account mismatch');
        const conflict = event.kind === 'progress' ? await this.repo.db.conflicts.get(id) : undefined;
        if (conflict?.server === null && conflict.currentRevision) {
          await refreshConflict(event, conflict.currentRevision);
          continue;
        }
        const delivery = event.kind === 'progress'
          ? await this.bridge.submitProgress(account, structuredClone(event.payload), controller.signal)
          : await this.bridge.submitActivity(account, structuredClone(event.payload), controller.signal);
        await current();
        if (delivery.status === 200) { await this.repo.acknowledge(lease, event, delivery.body); continue; }
        if (!validProblem(delivery.body, delivery.status)) throw new Error('Invalid HTTP Problem; event retained');
        if (delivery.status === 401 && delivery.body.code === 'unauthenticated') {
          if (await this.repo.expire(lease)) { this.status = 'auth-required'; this.expired(account); }
          return;
        }
        if (event.kind === 'progress' && delivery.status === 409 && delivery.body.code === 'progress_conflict' && delivery.body.current_revision) {
          await refreshConflict(event, delivery.body.current_revision);
          // Per-event CAS - A progress conflict cannot prevent the independent activity in this same lease.
          continue;
        }
        if (delivery.status >= 500 || delivery.status === 429) throw new Error('Temporary server failure; immutable event retained');
        this.status = 'blocked';
      }
      if (this.status === 'syncing') this.status = 'idle';
    } catch (error) {
      if (error instanceof ReadingHTTPError && error.status === 401 && validProblem(error.problem, 401) && error.problem.code === 'unauthenticated') {
        if (await this.repo.expire(lease)) { this.status = 'auth-required'; this.expired(account); }
      } else if (await this.repo.leaseCurrent(lease)) this.status = 'retryable-error';
    } finally { clearTimeout(timer); await this.repo.release(lease); if (this.abort === controller) this.abort = undefined; }
  }
}
