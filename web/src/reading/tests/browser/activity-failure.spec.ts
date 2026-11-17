import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!window.readingTest); });
for (const failure of ['progress', 'activity', 'lost-credit-result'] as const) test(`durable 30-second interval is credited once across ${failure} failure, retry and reload`, async ({ page }) => {
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
    const hook = (_key: unknown, event: import('../../repository').EventRow) => {
      if (!failed && event.kind === failure) { failed = true; throw new DOMException('Selective event quota fault', 'QuotaExceededError'); }
    };
    repo.db.events.hook('creating', hook);
    const reader = new p.ReaderController(host, value => { statuses.push(value); }, async location => { await repo.save(ref, { position: location.ko, fraction: location.fraction }); }, {
      credit: async measured => {
        candidates.push(measured);
        await repo.credit(ref, p.activityEvent(ref.documentId, device.id, measured), measured);
        if (failure === 'lost-credit-result' && !failed) { failed = true; throw new Error('Lost local result after committed credit'); }
      },
    });
    try {
      await reader.open(bytes); clock += 30000; await reader.next();
      const afterFailure = { state: statuses.at(-1)!.state, savedMessages: statuses.filter(s => s.message === 'Intentional navigation saved').length, checkpoint: (await repo.db.books.toArray())[0]!.checkpoint, activity: (await repo.db.events.toArray()).filter(e => e.kind === 'activity').length };
      await reader.next();
      const events = await repo.db.events.toArray(), credits = events.filter(e => e.kind === 'activity');
      const result = { name, ref, clock, measured: candidates[0]!, device, afterFailure, creditedSeconds: credits.reduce((sum, e) => sum + e.payload.duration, 0), activityIds: credits.map(e => e.id), candidateIds: candidates.map(c => c.intervalId), interval: credits[0]!.interval, finalState: statuses.at(-1)!.state };
      await reader.dispose(); repo.db.events.hook('creating').unsubscribe(hook); repo.db.close(); return result;
    } finally { Date.now = realNow; host.remove(); }
  }, failure);
  expect(first.afterFailure).toMatchObject({ state: 'error', savedMessages: 0, checkpoint: { position: null, fraction: null }, activity: failure === 'activity' ? 0 : 1 });
  expect(first.finalState).toBe('ready'); expect(first.creditedSeconds).toBe(30); expect(first.activityIds).toEqual([first.measured.intervalId]);
  expect(first.interval).toEqual({ id: first.measured.intervalId, startMs: first.measured.startMs, endMs: first.measured.endMs });
  expect(new Set(first.candidateIds).size).toBe(1);
  await page.reload(); await page.waitForFunction(() => !!window.readingTest);
  const reopened = await page.evaluate(async previous => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(previous.name)), realNow = Date.now; Date.now = () => previous.clock;
    const host = document.createElement('div'); host.style.cssText = 'width:700px;height:480px'; document.body.appendChild(host);
    try {
      // Exact Durable Retry - A lost result may be retried after realm/DB restart, never as a newly identified interval.
      await repo.credit(previous.ref, p.activityEvent(previous.ref.documentId, previous.device.id, previous.measured), previous.measured);
      let collision = false; try { await repo.credit(previous.ref, { ...p.activityEvent(previous.ref.documentId, previous.device.id, previous.measured), duration: 60 }, previous.measured); } catch { collision = true; }
      const opened = await repo.open(previous.ref);
      const reader = new p.ReaderController(host, () => {}, async location => { await repo.save(previous.ref, { position: location.ko, fraction: location.fraction }); }, { credit: measured => repo.credit(previous.ref, p.activityEvent(previous.ref.documentId, previous.device.id, measured), measured) });
      await reader.open(opened.source, opened.row.checkpoint.position || undefined, undefined, opened.manifest); await reader.next(); await reader.dispose();
      const credits = (await repo.db.events.toArray()).filter(e => e.kind === 'activity');
      const result = { ids: credits.map(e => e.id), seconds: credits.reduce((sum, e) => sum + e.payload.duration, 0), collision }; await repo.db.delete(); return result;
    } finally { Date.now = realNow; host.remove(); }
  }, first);
  expect(reopened).toEqual({ ids: first.activityIds, seconds: 30, collision: true });
});
