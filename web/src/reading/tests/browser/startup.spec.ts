import { expect, test } from '@playwright/test';
import type { ReadingBridge, ReadingSnapshot } from '../../types';

test('account replacement masks the old native frame and progress immediately without deleting its checkpoint', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  await page.evaluate(async () => {
    const p = window.readingTest, account = { origin: location.origin, userId: 'visible-A' }, ref = { kind: 'server' as const, account, documentId: 'server-A' }, repo = new p.Repository(); await repo.setAccess({ kind: 'authenticated', account }); await repo.install(ref, await (await fetch('/fixtures/synthetic.epub')).blob(), 'Private reader A', null, null, { document_id: ref.documentId, revision: '0', position: '/body/DocFragment[1]/body/h1', fraction: .12345, device_id: null, updated_at: null }); repo.db.close();
    const noHTTP = async () => { throw new Error('Unexpected request'); }, bridge: ReadingBridge = { getState: async () => ({ document_id: ref.documentId, revision: '0', position: '/body/DocFragment[1]/body/h1', fraction: .12345, device_id: null, updated_at: null }), fetchFile: async () => { const file = await (await fetch('/fixtures/synthetic.epub')).blob(); return new Response(file, { headers: { 'Content-Type': 'application/epub+zip' } }); }, fetchCover: noHTTP, registerDevice: async (_, d) => d, submitActivity: noHTTP, submitProgress: noHTTP }; Object.assign(window, { privacyBridge: bridge, privacyRef: ref }); p.mount(bridge, ref, { kind: 'authenticated', account });
  });
  const region = page.getByRole('region', { name: 'Book reader', exact: true }); await expect(region).toHaveAttribute('data-reader-state', 'ready');
  await page.evaluate(() => { const w = window as unknown as { privacyBridge: ReadingBridge; privacyRef: import('../../types').BookRef }; window.readingTest.mount(w.privacyBridge, w.privacyRef, { kind: 'authenticated', account: { origin: location.origin, userId: 'new-B' } }); });
  await expect(region.locator(':scope > div').first()).toHaveAttribute('hidden', ''); await expect(region.locator('header')).not.toContainText('Private reader A'); await expect(region.locator('footer')).toBeHidden();
  const retained = await page.evaluate(async () => { const repo = new window.readingTest.Repository(), row = (await repo.db.books.toArray())[0]!; const result = { checkpoint: row.checkpoint, events: await repo.db.events.count(), source: !!row.sourceId }; window.readingTest.unmount(); repo.db.close(); return result; }); expect(retained).toEqual({ checkpoint: { position: '/body/DocFragment[1]/body/h1', fraction: .12345 }, events: 0, source: true });
});

test('startup stays unready until the newer authenticated selection is persisted', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, account = { origin: location.origin, userId: 'login-during-cleanup' }, calls: string[] = [], snapshots: ReadingSnapshot[] = [];
    const file = await (await fetch('/fixtures/synthetic.epub')).blob(), noWrite = async () => { throw new Error('No event is created by startup/download'); };
    const bridge: ReadingBridge = { registerDevice: async (_, d) => d, fetchFile: async (a, id) => { calls.push(a.userId + ':' + id); return new Response(file, { headers: { 'Content-Type': 'application/epub+zip' } }); }, getState: async (_, id) => ({ document_id: id, revision: '0', position: null, fraction: null, device_id: null, updated_at: null }), fetchCover: noWrite, submitActivity: noWrite, submitProgress: noWrite };
    let projected!: () => void;
    const firstProjection = new Promise<void>(resolve => { projected = resolve; });
    const runtime = new p.ReadingRuntime(bridge, s => { snapshots.push(s); projected(); }, () => {}); await runtime.repo.db.open();
    let entered!: () => void, release!: () => void;
    const writing = new Promise<void>(resolve => { entered = resolve; });
    const permissionToWrite = new Promise<void>(resolve => { release = resolve; });
    const persist = runtime.repo.setAccess.bind(runtime.repo);
    runtime.repo.setAccess = async access => {
      if (access.kind === 'authenticated') { entered(); await permissionToWrite; }
      return persist(access);
    };
    const starting = runtime.start({ kind: 'loading' }), selecting = runtime.setAccess({ kind: 'authenticated', account });
    await writing;
    await firstProjection;
    const blockedSnapshots = snapshots.map(s => s.ready);
    release(); await selecting; await starting;
    const ref = { kind: 'server' as const, account, documentId: 'unchanged-server-id' }; const controller = new AbortController(); await runtime.openServerBook(ref, controller.signal); controller.abort();
    const after = snapshots.at(-1)!, access = await runtime.repo.db.access.toArray(), pending = await runtime.repo.pending(), output = { blockedSnapshots, ready: after.ready, account: runtime.projectionAccess.kind, calls, ref, authenticated: access.filter(a => a.authenticated).map(a => a.account.userId), pending: pending.length }; runtime.dispose(); await runtime.repo.db.delete(); return output;
  });
  expect(result.blockedSnapshots).toContain(false);
  expect(result.blockedSnapshots).not.toContain(true);
  expect(result).toMatchObject({ ready: true, account: 'authenticated', calls: ['login-during-cleanup:unchanged-server-id'], ref: { kind: 'server', documentId: 'unchanged-server-id' }, authenticated: ['login-during-cleanup'], pending: 0 });
});
