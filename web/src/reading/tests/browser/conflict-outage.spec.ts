import { expect, test } from '@playwright/test';
import type { ReadingBridge } from '../../types';

test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!window.readingTest); });
for (const failure of ['503', 'malformed', 'timeout', '401', 'logout'] as const) test(`CAS conflict with ${failure} detail read preserves progress and fences independent activity correctly`, async ({ page }) => {
  const result = await page.evaluate(async failure => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`detail-outage-${crypto.randomUUID()}`));
    const account = { origin: location.origin, userId: 'A' }, ref = { kind: 'server' as const, account, documentId: 'server-unchanged' };
    await repo.setAccess({ kind: 'authenticated', account }); const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    await repo.install(ref, bytes, null, null, null, { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null });
    const device = await repo.device(account);
    const realNow = Date.now; let eventClock = realNow(); Date.now = () => ++eventClock;
    try { await repo.save(ref, { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 }, { event_id: crypto.randomUUID(), document_id: ref.documentId, device_id: device.id, start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: .1, end_fraction: .2 }); } finally { Date.now = realNow; }
    const original = await repo.pending(), progress = original.find(e => e.kind === 'progress')!, activity = original.find(e => e.kind === 'activity')!;
    let progressCalls = 0, activityCalls = 0, expired = 0, readCalls = 0; const calls: string[] = [];
    const state = { document_id: ref.documentId, revision: '1', position: '/body/DocFragment[1]/body/p[20]', fraction: .8, device_id: 'owned-KO-device', updated_at: '2026-01-01T00:00:00Z' };
    const bridge: ReadingBridge = {
      registerDevice: async (_, d) => d, fetchFile: async () => { throw new Error('not used'); }, fetchCover: async () => { throw new Error('not used'); },
      submitProgress: async () => { calls.push('progress'); progressCalls++; return { status: 409, body: { type: 'about:blank', title: 'Conflict', status: 409, code: 'progress_conflict', detail: 'Real CAS seam is jointly qualified separately', current_revision: '1' } }; },
      submitActivity: async (_, event) => { calls.push('activity'); activityCalls++; return { status: 200, body: { event_id: event.event_id, kind: 'activity', revision: null } }; },
      getState: async () => {
        calls.push('state'); readCalls++;
        if (failure === 'timeout') return new Promise(() => {});
        if (failure === 'malformed') return { ...state, position: 42 } as unknown as typeof state;
        if (failure === 'logout') await repo.setAccess({ kind: 'logout', account });
        const status = failure === '401' ? 401 : 503;
        throw new p.ReadingHTTPError(status, { type: 'about:blank', title: 'Read failure', status, code: status === 401 ? 'unauthenticated' : 'storage_error', detail: 'Synthetic read-only outage' });
      },
    };
    const replay = new p.Replay(repo, bridge, () => {}, () => { expired++; }), started = performance.now();
    await replay.run(account); const firstElapsed = performance.now() - started;
    const pendingFirst = (await repo.pending()).map(e => e.id), decision = await repo.db.decisions.get(activity.id), conflict = await repo.db.conflicts.get(progress.id);
    repo.db.close(); await repo.db.open();
    if (failure !== '401' && failure !== 'logout') await replay.run(account);
    const beforeRefresh = { calls, progressCalls, readCalls, activityCalls, expired, firstElapsed, pendingFirst, receipt: decision?.receipt, conflict, status: replay.status, checkpoint: (await repo.db.books.toArray())[0]!.checkpoint };
    let refreshed: string | null = null;
    if (failure !== '401' && failure !== 'logout') { const access = (await repo.db.access.toArray())[0]!; const full = await repo.refreshConflict(progress.id, state, access.epoch); refreshed = full.server.revision; }
    const result = { ...beforeRefresh, progressId: progress.id, activityId: activity.id, pendingFinal: (await repo.pending()).map(e => e.id), refreshed, history: await repo.db.history.count() };
    await repo.db.delete(); return result;
  }, failure);
  expect(result.calls.slice(0, 2)).toEqual(['progress', 'state']);
  expect(result.conflict).toMatchObject({ server: null, currentRevision: '1', refreshed: false });
  expect(result.checkpoint).toEqual({ position: '/body/DocFragment[1]/body/p[1]', fraction: .2 }); expect(result.history).toBe(0);
  if (failure === '401' || failure === 'logout') { expect(result.activityCalls).toBe(0); expect(result.pendingFirst).toHaveLength(2); expect(result.expired).toBe(failure === '401' ? 1 : 0); }
  else {
    expect(result.pendingFirst).toEqual([result.progressId]); expect(result.pendingFinal).toEqual([result.progressId]);
    expect(result.progressCalls).toBe(1); expect(result.readCalls).toBe(2); expect(result.activityCalls).toBe(1); expect(result.expired).toBe(0);
    expect(result.receipt).toEqual({ event_id: result.activityId, kind: 'activity', revision: null }); expect(result.refreshed).toBe('1'); expect(result.status).toBe('conflict');
    expect(result.conflict!.refreshError).toContain('Retry synchronization'); expect(result.firstElapsed).toBeLessThan(6000);
  }
});

test('a full lease of needs-refresh conflicts cannot starve activity beyond the first batch', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`conflict-backlog-${crypto.randomUUID()}`));
    const account = { origin: location.origin, userId: 'A' }, ref = { kind: 'server' as const, account, documentId: 'original-id' };
    await repo.setAccess({ kind: 'authenticated', account }); const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    await repo.install(ref, bytes, null, null, null, { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null });
    const device = await repo.device(account), id = crypto.randomUUID(), realNow = Date.now; let clock = realNow(); Date.now = () => ++clock;
    try {
      for (let n = 0; n < 32; n++) {
        const distinct = { ...ref, documentId: `conflicted-${n}` };
        await repo.install(distinct, bytes, null, null, null, { document_id: distinct.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null });
        await repo.save(distinct, { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 });
      }
      await repo.credit(ref, { event_id: id, document_id: ref.documentId, device_id: device.id, start_time: '2026-01-01T00:00:00Z', duration: 30, start_fraction: .1, end_fraction: .2 });
    } finally { Date.now = realNow; }
    let activity = 0, progress = 0;
    const unavailable = async () => { throw new p.ReadingHTTPError(503, { type: 'about:blank', title: 'Busy', status: 503, code: 'storage_error', detail: 'State-only outage' }); };
    const bridge: ReadingBridge = { registerDevice: async (_, d) => d, getState: unavailable, fetchFile: unavailable, fetchCover: unavailable,
      submitProgress: async () => { progress++; return { status: 409, body: { type: 'about:blank', title: 'Conflict', status: 409, code: 'progress_conflict', detail: 'Changed', current_revision: '1' } }; },
      submitActivity: async (_, event) => { activity++; return { status: 200, body: { event_id: event.event_id, kind: 'activity', revision: null } }; },
    };
    const replay = new p.Replay(repo, bridge, () => {}, () => {}); await replay.run(account); const afterFirst = activity; await replay.run(account); await replay.run(account);
    const output = { afterFirst, activity, progress, pending: (await repo.pending()).length, receipt: (await repo.db.decisions.get(id))?.receipt, missingStates: (await repo.db.conflicts.toArray()).filter(c => c.server === null).length };
    await repo.db.delete(); return output;
  });
  expect(result).toMatchObject({ afterFirst: 0, activity: 1, progress: 32, pending: 32, missingStates: 32, receipt: { kind: 'activity', revision: null } });
});

test('public conflict projection survives repository restart without invented state and refreshes through Retry synchronization', async ({ page }) => {
  await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(), account = { origin: location.origin, userId: 'A' }, ref = { kind: 'server' as const, account, documentId: 'original-id' };
    await repo.setAccess({ kind: 'authenticated', account }); const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    await repo.install(ref, bytes, null, null, null, { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null });
    await repo.save(ref, { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 });
    let restored = false;
    const unavailable = async () => { throw new p.ReadingHTTPError(503, { type: 'about:blank', title: 'Busy', status: 503, code: 'storage_error', detail: 'Read-only outage' }); };
    const bridge: ReadingBridge = { registerDevice: async (_, d) => d, fetchFile: unavailable, fetchCover: unavailable, submitActivity: unavailable,
      submitProgress: async () => ({ status: 409, body: { type: 'about:blank', title: 'Conflict', status: 409, code: 'progress_conflict', detail: 'Changed', current_revision: '1' } }),
      getState: async () => restored ? { document_id: ref.documentId, revision: '1', position: '/body/DocFragment[1]/body/p[20]', fraction: .8, device_id: 'server-device', updated_at: '2026-01-01T00:00:00Z' } : unavailable(),
    };
    await new p.Replay(repo, bridge, () => {}, () => {}).run(account); repo.db.close();
    Object.assign(window, { restoreConflictRead: () => { restored = true; } }); p.showSync(account, bridge);
  });
  const projection = async () => JSON.parse(await page.locator('#sync-projection').innerText());
  await expect.poll(projection).toMatchObject({ ready: true, sync: 'conflict', pending: 1, conflicts: [], error: expect.stringContaining('Retry synchronization') });
  await page.evaluate(() => (window as unknown as { restoreConflictRead(): void }).restoreConflictRead());
  await page.getByRole('button', { name: 'Retry synchronization', exact: true }).click();
  await expect.poll(async () => (await projection()).conflicts).toMatchObject([{ server: { revision: '1', position: '/body/DocFragment[1]/body/p[20]', fraction: .8 } }]);
  expect((await projection()).pending).toBe(1);
});

test('late details cannot downgrade fresh state or resurrect a durably resolved needs-refresh event', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const p = window.readingTest, repo = new p.Repository(new p.ReadingDB(`late-details-${crypto.randomUUID()}`));
    const account = { origin: location.origin, userId: 'A' }, ref = { kind: 'server' as const, account, documentId: 'original-id' };
    await repo.setAccess({ kind: 'authenticated', account }); const bytes = await (await fetch('/fixtures/synthetic.epub')).arrayBuffer();
    await repo.install(ref, bytes, null, null, null, { document_id: ref.documentId, revision: '0', position: null, fraction: null, device_id: null, updated_at: null });
    await repo.save(ref, { position: '/body/DocFragment[1]/body/p[1]', fraction: .2 });
    const event = (await repo.pending())[0]!, lease = (await repo.claim(account, 'detail-reader'))!, access = (await repo.db.access.toArray())[0]!;
    const state = { document_id: ref.documentId, revision: '2', position: '/body/DocFragment[1]/body/p[20]', fraction: .8, device_id: 'server-device', updated_at: '2026-01-01T00:00:00Z' };
    await repo.recordConflict(lease, event, null, '1'); await repo.refreshConflict(event.id, state, access.epoch);
    await repo.recordConflict(lease, event, { ...state, revision: '1' });
    const observed = (await repo.db.conflicts.get(event.id))!.server!.revision;
    await repo.resolve(event.id, 'server', '2');
    await repo.recordConflict(lease, event, null, '1', 'Late read failure'); await repo.recordConflict(lease, event, { ...state, revision: '1' });
    const result = { observed, conflicts: await repo.db.conflicts.count(), history: await repo.db.history.count(), pending: (await repo.pending()).length, checkpoint: (await repo.db.books.toArray())[0]!.checkpoint };
    await repo.db.delete(); return result;
  });
  expect(result).toEqual({ observed: '2', conflicts: 0, history: 1, pending: 0, checkpoint: { position: '/body/DocFragment[1]/body/p[20]', fraction: .8 } });
});
