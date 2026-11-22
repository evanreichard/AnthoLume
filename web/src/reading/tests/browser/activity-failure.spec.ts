import { expect, test } from '@playwright/test';
import type { OfflineRecord } from '../../types';

test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!window.readingTest); });
for (const failure of ['progress', 'activity', 'lost-save-result'] as const) test(`one local 30-second interval survives ${failure} failure, retry and reload`, async ({ page }) => {
  const first = await page.evaluate(async failure => {
    const p = window.readingTest, name = `interval-${crypto.randomUUID()}`, repo = new p.Repository(new p.ReadingDB(name));
    const account = { origin: location.origin, userId: 'activity-A' }, ref = { kind: 'server' as const, account, documentId: 'original-server-document' };
    await repo.setAccess({ kind: 'authenticated', account });
    const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    await repo.install(ref, bytes, 'Interval book', null, null, { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null });
    const device = await repo.device(account), realNow = Date.now; let clock = realNow(); Date.now = () => clock;
    const host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host);
    const statuses: import('../../controller').ReaderStatus[] = [], candidates: import('../../activity').CapturedActivity[] = [];
    let failed = false;
    const hook = (_key: unknown, record: OfflineRecord) => {
      if (!failed && record.kind === failure) { failed = true; throw new DOMException('Selective capture quota fault', 'QuotaExceededError'); }
    };
    repo.db.offline.hook('creating', hook);
    const reader = new p.ReaderController(host, value => { statuses.push(value); }, async (location, measured) => {
      if (measured) candidates.push(measured);
      await repo.recordCapture(ref, { position: location.ko, fraction: location.fraction }, measured && p.activityEvent(ref.documentId, device.id, measured), { current: () => true });
      if (failure === 'lost-save-result' && !failed) { failed = true; throw new Error('Lost local result after committed capture'); }
    });
    try {
      await reader.open(bytes); clock += 30000; await reader.next();
      const afterFailure = { state: statuses.at(-1)!.state, savedMessages: statuses.filter(s => s.message === 'Intentional navigation saved').length, records: (await repo.db.offline.toArray()).map(row => row.kind).sort() };
      await reader.next();
      const records = await repo.db.offline.toArray(), credits = records.filter(row => row.kind === 'activity');
      const result = { name, ref, measured: candidates[0]!, device, afterFailure, credits: credits.map(row => row.event), candidateIds: candidates.map(c => c.intervalId), finalState: statuses.at(-1)!.state, pending: await repo.pending() };
      await reader.dispose(); repo.db.close(); return result;
    } finally { Date.now = realNow; host.remove(); }
  }, failure);
  expect(first.afterFailure).toEqual({ state: 'error', savedMessages: 0, records: failure === 'lost-save-result' ? ['activity', 'progress'] : [] });
  expect(first.finalState).toBe('ready');
  expect(first.credits).toMatchObject([{ event_id: first.measured.intervalId, duration: 30 }]);
  expect(new Set(first.candidateIds).size).toBe(1);
  expect(first.pending).toEqual([]);
  await page.reload(); await page.waitForFunction(() => !!window.readingTest);
  const reopened = await page.evaluate(async previous => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(previous.name));
    const event = p.activityEvent(previous.ref.documentId, previous.device.id, previous.measured);
    await repo.recordCapture(previous.ref, undefined, event, { current: () => true });
    const collision = await repo.recordCapture(previous.ref, undefined, { ...event, duration: 60 }, { current: () => true }).then(() => false, () => true);
    const credits = (await repo.db.offline.toArray()).flatMap(row => row.kind === 'activity' ? [row.event] : []);
    const pending = await repo.replayBatch(previous.ref.account);
    await repo.db.delete(); return { credits, pending, collision };
  }, first);
  expect(reopened).toEqual({ credits: first.credits, pending: null, collision: true });
});
