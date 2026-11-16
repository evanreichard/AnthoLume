import { Repository, type ReadingEvent, type Scope } from './storage';
import { receiptFor } from './wire';
export type Delivery = { status: 200; scope: Scope; receipts: unknown } | { status: 401 | 409 | 500; scope: Scope; current_revision?: string };
export interface Transport { send(scope: Scope, events: ReadingEvent[]): Delivery | Promise<Delivery> }

export class SyncCoordinator {
  constructor(private repository: Repository, private transport: Transport, private owner: string, private now: () => number) {}
  async replay(scope: Scope): Promise<'idle-or-paused' | 'acknowledged' | 'auth-required' | 'retryable' | 'blocked'> {
    const lease = await this.repository.claim(scope, this.owner, this.now());
    if (!lease) return 'idle-or-paused';
    try {
      const records = await this.repository.db.events.bulkGet(lease.ids);
      if (records.some(event => !event || event.scope !== scope)) return 'blocked';
      const result = await this.transport.send(scope, records as ReadingEvent[]);
      if (result.scope !== scope) return 'blocked';
      if (result.status === 401) return await this.repository.expireLease(lease, this.now()) ? 'auth-required' : 'idle-or-paused';
      if (result.status === 409) return 'blocked';
      if (result.status !== 200) return 'retryable';
      const receipts = result.receipts;
      if (!Array.isArray(receipts) || receipts.length !== records.length || !records.every(event => event && receipts.filter(receipt => receiptFor(receipt, event)).length === 1)) return 'blocked';
      await this.repository.acknowledge(lease, receipts, this.now(), result.scope);
      return 'acknowledged';
    } catch { return 'retryable'; }
  }
}
