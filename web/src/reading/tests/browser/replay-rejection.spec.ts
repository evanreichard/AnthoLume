import { expect, test } from '@playwright/test';
import type { ReadingBridge } from '../../types';

test('terminal failures survive reload without starving the next book', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const { Repository, ReadingDB, Replay, verifiedCapture } = window.readingTest;
    const repo = new Repository(new ReadingDB(`rejected-${crypto.randomUUID()}`));
    const account = { origin: location.origin, userId: 'A' };
    await repo.setAccess({ kind: 'authenticated', account });
    const device = await repo.device(account);
    for (let i = 0; i < 33; i++) {
      const documentId = i < 32 ? 'deleted' : 'live';
      await verifiedCapture(repo, { kind: 'server', documentId, account }, undefined, { document_id: documentId, device_id: device.id, event_id: crypto.randomUUID(), start_time: new Date().toISOString(), duration: 30, start_fraction: 0, end_fraction: .1 });
    }
    const unexpected = async (): Promise<never> => { throw new Error('Unexpected bridge call'); };
    const sent: string[] = [];
    const bridge: ReadingBridge = { registerDevice: async (_, d) => d, getState: unexpected, fetchFile: unexpected, fetchCover: unexpected, submitProgress: unexpected,
      submitActivity: async (_, event) => {
        sent.push(event.document_id);
        return event.document_id === 'live' ? { status: 200, body: { event_id: event.event_id, kind: 'activity', revision: null } } : { status: 404, body: { type: 'about:blank', title: 'Not Found', detail: '', status: 404, code: 'not_found' } };
      },
    };
    const run = () => new Replay(repo, bridge, () => {}, () => {}).run(account);
    await run(); repo.db.close(); await repo.db.open(); await run(); await run();
    const rejected = (await repo.pending()).filter(e => e.rejected?.code === 'not_found').length;
    await repo.db.delete(); return { count: sent.length, live: sent.includes('live'), rejected };
  });
  expect(result).toEqual({ count: 33, live: true, rejected: 32 });
});
