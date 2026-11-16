import type { ReadingEvent, Scope } from './storage';
import type { Delivery } from './sync';
import { validSubmission, revisionPattern, type Receipt } from './wire';

export type Position = { ko: string; fraction: number; revision: string };
export class ProgressTransportFake {
  private head: Position = { ko: '/body/DocFragment[1]/body/p[1]', fraction: 0, revision: '0' };
  read(): Position { return { ...this.head }; }
  propose(local: Omit<Position, 'revision'>, baseRevision: string) {
    if (!revisionPattern.test(baseRevision)) throw new Error('Invalid opaque revision');
    if (baseRevision !== this.head.revision || this.head.revision === '999999999999999999') return { state: 'choice-required' as const, local: { ...local }, server: this.read() };
    this.head = { ...local, revision: (BigInt(this.head.revision) + 1n).toString() };
    return { state: 'committed' as const, server: this.read() };
  }
  choose(choice: 'local' | 'server', conflict: { local: Omit<Position, 'revision'>; server: Position }) {
    if (choice === 'server') return { state: 'selected-server' as const, server: this.read() };
    return this.propose(conflict.local, conflict.server.revision);
  }
}

// Deterministic Fake - Each event models an individual API transaction; receipts are checked before CAS on retry.
export class ReceiptTransportFake {
  readonly receipts = new Map<string, { digest: string; receipt: Receipt }>();
  private heads = new Map<string, ProgressTransportFake>();
  creditedSeconds = 0;
  authenticated = true;
  failStatus?: 500;
  dropNextResponse = false;
  progress(scope: Scope, document: string): ProgressTransportFake {
    const key = JSON.stringify([scope, document]);
    if (!this.heads.has(key)) this.heads.set(key, new ProgressTransportFake());
    return this.heads.get(key)!;
  }
  send(scope: Scope, events: ReadingEvent[]): Delivery {
    if (!this.authenticated) return { status: 401, scope };
    if (this.failStatus) return { status: this.failStatus, scope };
    const receipts: Receipt[] = [];
    for (const event of events) {
      if (event.scope !== scope || !validSubmission(event) || event.id !== event.payload.event_id || event.document !== event.payload.document_id) throw new Error('Invalid scoped API event');
      const key = JSON.stringify([scope, event.id]);
      const digest = JSON.stringify({ kind: event.kind, payload: event.payload });
      const existing = this.receipts.get(key);
      if (existing) {
        if (existing.digest !== digest) return { status: 409, scope };
        receipts.push({ ...existing.receipt });
        continue;
      }
      let revision: string | null = null;
      if (event.kind === 'progress') {
        const p = event.payload;
        const result = this.progress(scope, event.document).propose({ ko: p.position, fraction: p.fraction }, p.base_revision);
        if (result.state === 'choice-required') return { status: 409, scope, current_revision: result.server.revision };
        revision = result.server.revision;
      } else this.creditedSeconds += event.payload.duration;
      const receipt: Receipt = { event_id: event.id, kind: event.kind, revision };
      this.receipts.set(key, { digest, receipt });
      receipts.push({ ...receipt });
    }
    if (this.dropNextResponse) { this.dropNextResponse = false; throw new Error('Response lost after commit'); }
    return { status: 200, scope, receipts };
  }
}
