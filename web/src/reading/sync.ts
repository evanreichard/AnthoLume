import {
  accountKey,
  ReadingHTTPError,
  type Account,
  type ReadingBridge,
  type ReadingSnapshot,
  type SyncStatus,
} from './types';
import { Repository } from './repository';
import { validDevice, validProblem, validState } from './protocol';

export class Replay {
  private running: Promise<void> | null = null;
  private abort?: AbortController;
  status: SyncStatus = 'idle';
  notice: ReadingSnapshot['notice'] = null;
  constructor(
    private repo: Repository,
    private bridge: ReadingBridge,
    private changed: () => void,
    private expired: (account: Account) => void,
  ) {}
  stop() {
    this.abort?.abort();
    this.notice = null;
    this.status = 'idle';
  }
  run(account: Account): Promise<void> {
    if (this.running) return this.running;
    const controller = (this.abort = new AbortController());
    this.running = this.perform(account, controller).finally(() => {
      this.abort = undefined;
      this.running = null;
      this.changed();
    });
    return this.running;
  }
  private async perform(account: Account, controller: AbortController) {
    const batch = await this.repo.replayBatch(account);
    if (!batch || controller.signal.aborted) return;
    const { access, ids } = batch;
    this.status = 'syncing';
    this.changed();
    const timer = setTimeout(() => controller.abort(), 25000);
    const current = async () => {
      controller.signal.throwIfAborted();
      if (!(await this.repo.replayCurrent(access))) throw new Error('Account access changed');
      controller.signal.throwIfAborted();
    };

    try {
      const device = await this.repo.device(account);
      await current();
      const registered = await this.bridge.registerDevice(account, device, controller.signal);
      await current();
      if (!validDevice(registered, device.id)) throw new Error('Device registration was not exact');
      for (const id of ids) {
        await current();
        const event = await this.repo.db.events.get(id);
        if (!event || event.rejected) continue;
        if (event.scope !== accountKey(account)) throw new Error('Immutable event account mismatch');
        const delivery =
          event.kind === 'progress'
            ? await this.bridge.submitProgress(account, structuredClone(event.payload), controller.signal)
            : await this.bridge.submitActivity(account, structuredClone(event.payload), controller.signal);
        await current();
        if (delivery.status === 200) {
          await this.repo.acknowledge(access, event, delivery.body);
          if (event.kind === 'progress' && !controller.signal.aborted) this.bridge.progressAcknowledged?.(account);
          continue;
        }
        if (!validProblem(delivery.body, delivery.status)) throw new Error('Invalid HTTP Problem; event retained');
        if (delivery.status === 401 && delivery.body.code === 'unauthenticated') {
          if (!controller.signal.aborted && (await this.repo.expire(access, event.id))) {
            this.status = 'auth-required';
            this.expired(account);
            return;
          }
          continue;
        }
        if (
          event.kind === 'progress' &&
          delivery.status === 409 &&
          delivery.body.code === 'progress_conflict' &&
          delivery.body.current_revision
        ) {
          const state = await this.bridge.getState(
            account,
            event.payload.document_id,
            AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]),
          );
          await current();
          if (
            !validState(state, event.payload.document_id) ||
            BigInt(state.revision) < BigInt(delivery.body.current_revision)
          )
            throw new Error('Invalid server position');
          if ((await this.repo.acceptServer(access, event, state)) && !controller.signal.aborted) {
            this.notice = {
              id: event.id,
              message: 'Resume position changed on another device. Choose where to resume when you reopen this book.',
            };
          }
          continue;
        }
        const { code } = delivery.body;
        if (
          (delivery.status === 404 && code === 'not_found') ||
          (delivery.status === 400 && code === 'invalid_request') ||
          (delivery.status === 409 && (code === 'idempotency_conflict' || code === 'revision_exhausted'))
        ) {
          await this.repo.reject(access, event, delivery.status, code);
          continue;
        }
        throw new Error('Temporary or unknown server failure; immutable event retained');
      }
      if (this.status === 'syncing') this.status = 'idle';
    } catch (error) {
      if (
        error instanceof ReadingHTTPError &&
        error.status === 401 &&
        validProblem(error.problem, 401) &&
        error.problem.code === 'unauthenticated'
      ) {
        if (!controller.signal.aborted && (await this.repo.expire(access))) {
          this.status = 'auth-required';
          this.expired(account);
        }
      } else if (this.abort === controller && (await this.repo.replayCurrent(access))) this.status = 'retryable-error';
    } finally {
      clearTimeout(timer);
    }
  }
}
