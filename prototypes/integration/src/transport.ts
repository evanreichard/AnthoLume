import createClient from 'openapi-fetch';
import type { paths } from '../../api-contract/client/schema.gen';
import type { ReadingEvent, Scope } from '../../reader-storage/src/storage';
import type { Delivery, Transport } from '../../reader-storage/src/sync';
import { revisionPattern } from '../../reader-storage/src/wire';

export class HTTPTransport implements Transport {
  csrf = '';
  conflict: { id: string; revision: string } | undefined;
  deliveries: { id: string; status: number }[] = [];
  private client = createClient<paths>({ baseUrl: location.origin, credentials: 'same-origin' });

  async send(scope: Scope, events: ReadingEvent[]): Promise<Delivery> {
    const receipts: unknown[] = [];
    for (const event of events) {
      const params = { header: { 'X-CSRF-Token': this.csrf } };
      const result = event.kind === 'progress'
        ? await this.client.POST('/api/v1/me/reading-progress', { params, body: event.payload })
        : await this.client.POST('/api/v1/me/activity', { params, body: event.payload });
      const status = result.response.status;
      this.deliveries.push({ id: event.id, status });
      if (status === 401) return { status: 401, scope };
      if (status === 409) {
        const problem: unknown = result.error;
        if (typeof problem === 'object' && problem !== null && 'code' in problem && problem.code === 'progress_conflict' && 'current_revision' in problem && typeof problem.current_revision === 'string' && revisionPattern.test(problem.current_revision)) {
          this.conflict = { id: event.id, revision: problem.current_revision };
          return { status: 409, scope, current_revision: problem.current_revision };
        }
        return { status: 409, scope };
      }
      if (status !== 200) return { status: 500, scope };
      // Runtime Gate - Generated types do not validate received JSON. The actual coordinator/repository validate each raw receipt before deletion.
      receipts.push(result.data);
    }
    return { status: 200, scope, receipts };
  }
}
