import Dexie, { type Table } from 'dexie';
import { validateEPUB } from './content-policy';
import { receiptFor, validSubmission, type Submission } from './wire';

export type Scope = 'local' | `remote:${string}`;
export function accountScope(origin: string, account: string): Scope { return `remote:${JSON.stringify([origin, account])}`; }
export type BookRecord = { key: string; scope: Scope; document: string; title: string; bytes: Blob; state: 'available'; size: number };
export type Checkpoint = { key: string; scope: Scope; document: string; ko: string; sequence: number };
export type ReadingEvent = { id: string; scope: Scope; document: string; sequence: number; schema: 2 } & Submission;
export type Lease = { scope: Scope; owner: string; fence: number; accessEpoch: number; until: number; ids: string[] };
export type Access = { scope: Scope; visible: boolean; authenticated: boolean; epoch: number };

export class ReaderDB extends Dexie {
  books!: Table<BookRecord, string>;
  checkpoints!: Table<Checkpoint, string>;
  events!: Table<ReadingEvent, string>;
  leases!: Table<Lease, string>;
  access!: Table<Access, string>;
  constructor(name = 'antholume-m2-reader-storage-v2') {
    super(name);
    this.version(1).stores({ books: '&key,scope', checkpoints: '&key,scope', events: '&id,scope,[scope+document]', leases: '&scope', access: '&scope' });
  }
}
export function bookKey(scope: Scope, document: string) { return JSON.stringify([scope, document]); }
export class Repository {
  constructor(readonly db = new ReaderDB()) {}
  async signIn(scope: Scope) {
    await this.db.transaction('rw', this.db.access, this.db.leases, async () => {
      const origin = (value: Scope) => value === 'local' ? '' : JSON.parse(value.slice(7))[0] as string;
      for (const other of await this.db.access.toArray()) {
        if (other.scope !== scope && origin(other.scope) === origin(scope)) {
          await this.db.access.put({ ...other, visible: false, authenticated: false, epoch: other.epoch + 1 });
          await this.invalidateLease(other.scope);
        }
      }
      const previous = await this.db.access.get(scope);
      await this.db.access.put({ scope, visible: true, authenticated: true, epoch: (previous?.epoch || 0) + 1 });
      await this.invalidateLease(scope);
    });
  }
  private async invalidateLease(scope: Scope) {
    const lease = await this.db.leases.get(scope);
    if (lease) await this.db.leases.put({ ...lease, fence: lease.fence + 1, until: 0, ids: [] });
  }
  async expire(scope: Scope) {
    await this.db.transaction('rw', this.db.access, this.db.leases, async () => {
      const previous = await this.db.access.get(scope);
      if (previous) await this.db.access.put({ ...previous, authenticated: false, epoch: previous.epoch + 1 });
      await this.invalidateLease(scope);
    });
  }
  private async leaseIsCurrent(lease: Lease, now: number) {
    const current = await this.db.leases.get(lease.scope);
    const access = await this.db.access.get(lease.scope);
    return !!(access?.authenticated && access.visible && access.epoch === lease.accessEpoch && current && current.accessEpoch === lease.accessEpoch && current.owner === lease.owner && current.fence === lease.fence && current.until > now);
  }
  async expireLease(lease: Lease, now: number): Promise<boolean> {
    return this.db.transaction('rw', this.db.access, this.db.leases, async () => {
      if (!await this.leaseIsCurrent(lease, now)) return false;
      const access = (await this.db.access.get(lease.scope))!;
      await this.db.access.put({ ...access, authenticated: false, epoch: access.epoch + 1 });
      await this.invalidateLease(lease.scope);
      return true;
    });
  }
  async logout(scope: Scope) {
    await this.db.transaction('rw', this.db.access, this.db.leases, async () => {
      const previous = await this.db.access.get(scope);
      await this.db.access.put({ scope, visible: false, authenticated: false, epoch: (previous?.epoch || 0) + 1 });
      await this.invalidateLease(scope);
    });
  }
  private async canRead(scope: Scope) { return scope === 'local' || !!(await this.db.access.get(scope))?.visible; }
  async books(scope: Scope) { return await this.canRead(scope) ? this.db.books.where('scope').equals(scope).toArray() : []; }
  async open(scope: Scope, document: string) {
    if (!await this.canRead(scope)) throw new Error('Downloads hidden for signed-out account');
    const record = await this.db.books.get(bookKey(scope, document));
    if (!record || record.bytes.size !== record.size || !record.size) throw new Error('Book unavailable or evicted');
    return record;
  }
  async importBook(scope: Scope, document: string, title: string, bytes: ArrayBuffer, failBeforeCommit = false) {
    await validateEPUB(bytes);
    const record: BookRecord = { key: bookKey(scope, document), scope, document, title, bytes: new Blob([bytes], { type: 'application/epub+zip' }), size: bytes.byteLength, state: 'available' };
    await this.db.transaction('rw', this.db.books, this.db.checkpoints, async () => {
      await this.db.books.add(record);
      if (failBeforeCommit) throw new Error('Injected interruption before complete-book commit');
      await this.db.checkpoints.add({ key: record.key, scope, document, ko: '', sequence: 0 });
    });
  }
  async accept(scope: Scope, document: string, ko: string, event?: Submission) {
    if (scope !== 'local' && (!event || !validSubmission(event) || event.payload.document_id !== document || (event.kind === 'progress' && event.payload.position !== ko))) throw new Error('Remote checkpoint requires a matching API event');
    if (scope === 'local' && event) throw new Error('Local-only checkpoint cannot enqueue a server event');
    return this.db.transaction('rw', this.db.books, this.db.checkpoints, this.db.events, this.db.access, async () => {
      if (!await this.canRead(scope)) throw new Error('Account hidden');
      const key = bookKey(scope, document);
      if (!await this.db.books.get(key)) throw new Error('Book unavailable');
      const old = await this.db.checkpoints.get(key);
      const sequence = (old?.sequence || 0) + 1;
      await this.db.checkpoints.put({ key, scope, document, ko, sequence });
      if (event) await this.db.events.add({ ...event, id: event.payload.event_id, scope, document, sequence, schema: 2 });
      return event?.payload.event_id;
    });
  }
  async claim(scope: Scope, owner: string, now: number, ttl = 1000): Promise<Lease | undefined> {
    if (scope === 'local') return;
    return this.db.transaction('rw', this.db.access, this.db.events, this.db.leases, async () => {
      const access = await this.db.access.get(scope);
      if (!access?.authenticated || !access.visible) return;
      const old = await this.db.leases.get(scope);
      if (old && old.until > now) return;
      const ids = (await this.db.events.where('scope').equals(scope).sortBy('sequence')).slice(0, 32).map(event => event.id);
      if (!ids.length) return;
      const lease: Lease = { scope, owner, accessEpoch: access.epoch, until: now + ttl, fence: Math.max(old?.fence || 0, access.epoch) + 1, ids };
      await this.db.leases.put(lease);
      return lease;
    });
  }
  async acknowledge(lease: Lease, receipts: unknown, now: number, responseScope = lease.scope) {
    return this.db.transaction('rw', this.db.access, this.db.leases, this.db.events, async () => {
      const current = await this.db.leases.get(lease.scope);
      if (responseScope !== lease.scope || !current || !await this.leaseIsCurrent(lease, now)) throw new Error('Stale or account-mismatched acknowledgement');
      if (!Array.isArray(receipts) || !receipts.length) throw new Error('Missing receipt array');
      const ids: string[] = [];
      for (const receipt of receipts) {
        if (typeof receipt !== 'object' || receipt === null || !('event_id' in receipt) || typeof receipt.event_id !== 'string' || !current.ids.includes(receipt.event_id) || ids.includes(receipt.event_id)) throw new Error('Invalid acknowledged ID');
        const event = await this.db.events.get(receipt.event_id);
        if (!event || event.scope !== lease.scope || !receiptFor(receipt, event)) throw new Error('Invalid event receipt');
        ids.push(receipt.event_id);
      }
      await this.db.events.bulkDelete(ids);
      await this.db.leases.put({ ...current, until: now, ids: [] });
    });
  }
}
