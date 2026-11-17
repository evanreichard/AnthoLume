import { expect, test } from '@playwright/test';
import type { ReadingBridge, ReadingSnapshot } from '../../types';

test('account replacement masks the old native frame and progress immediately without deleting its checkpoint', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  await page.evaluate(async () => {
    const p = window.readingTest, account = { origin: location.origin, userId: 'visible-A' }, ref = { kind: 'server' as const, account, documentId: 'server-A' }, repo = new p.Repository(); await repo.setAccess({ kind: 'authenticated', account }); await repo.install(ref, await (await fetch('/fixtures/synthetic.epub')).blob(), 'Private reader A', null, null, { document_id: ref.documentId, revision: '0', position: '/body/DocFragment[1]/body/h1', fraction: .12345, device_id: null, updated_at: null }); repo.db.close();
    const noHTTP = async () => { throw new Error('Stored opening requires no HTTP'); }, bridge: ReadingBridge = { getState: noHTTP, fetchFile: noHTTP, fetchCover: noHTTP, registerDevice: async (_, d) => d, submitActivity: noHTTP, submitProgress: noHTTP }; p.WorkerCoordinator.prototype.start = async function () { this.ready = true; }; Object.assign(window, { privacyBridge: bridge, privacyRef: ref }); p.mount(bridge, ref, { kind: 'authenticated', account });
  });
  const region = page.getByRole('region', { name: 'Book reader', exact: true }); await expect(region).toHaveAttribute('data-reader-state', 'ready');
  await page.evaluate(() => { const w = window as unknown as { privacyBridge: ReadingBridge; privacyRef: import('../../types').BookRef }; window.readingTest.mount(w.privacyBridge, w.privacyRef, { kind: 'authenticated', account: { origin: location.origin, userId: 'new-B' } }); });
  await expect(region.locator(':scope > div').first()).toHaveAttribute('hidden', ''); await expect(region.locator('header')).not.toContainText('Private reader A'); await expect(region.locator('footer span')).toHaveText('Book hidden'); await expect(region.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
  const retained = await page.evaluate(async () => { const repo = new window.readingTest.Repository(), row = (await repo.db.books.toArray())[0]!; const result = { checkpoint: row.checkpoint, events: await repo.db.events.count(), source: !!row.sourceId }; window.readingTest.unmount(); repo.db.close(); return result; }); expect(retained).toEqual({ checkpoint: { position: '/body/DocFragment[1]/body/h1', fraction: .12345 }, events: 0, source: true });
});

test('native IDB-delayed startup cannot replay loading over a newer authenticated selection', async ({ page }) => {
  await page.goto('/'); await page.waitForFunction(() => !!window.readingTest);
  const result = await page.evaluate(async () => {
    const p = window.readingTest, account = { origin: location.origin, userId: 'login-during-cleanup' }, calls: string[] = [], snapshots: ReadingSnapshot[] = [];
    const file = await (await fetch('/fixtures/synthetic.epub')).blob(), noWrite = async () => { throw new Error('No event is created by startup/download'); };
    const bridge: ReadingBridge = { registerDevice: async (_, d) => d, fetchFile: async (a, id) => { calls.push(a.userId + ':' + id); return new Response(file, { headers: { 'Content-Type': 'application/epub+zip' } }); }, getState: async (_, id) => ({ document_id: id, revision: '0', position: null, fraction: null, device_id: null, updated_at: null }), fetchCover: noWrite, submitActivity: noWrite, submitProgress: noWrite };
    p.WorkerCoordinator.prototype.start = async function () { this.ready = true; };
    const runtime = new p.ReadingRuntime(bridge, s => snapshots.push(s), () => {}); await runtime.repo.db.open();
    const native = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('antholume-reading-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = native.transaction('sources', 'readwrite'); let hold = true; const pump = () => { if (hold) tx.objectStore('sources').get('startup-lock').onsuccess = pump; }; pump();
    const starting = runtime.start({ kind: 'loading' }), selecting = runtime.setAccess({ kind: 'authenticated', account });
    await new Promise(resolve => setTimeout(resolve, 40)); const readyWhileBlocked = snapshots.some(s => s.ready); hold = false;
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); native.close(); await selecting; await starting;
    const ref = await runtime.download({ id: 'unchanged-server-id', title: null, author: null, description: null, series: null, lang: null, file_available: true, cover_available: false, file_size_bytes: file.size, media_type: 'application/epub+zip' });
    const after = snapshots.at(-1)!, access = await runtime.repo.db.access.toArray(), pending = await runtime.repo.pending(), output = { readyWhileBlocked, ready: after.ready, account: runtime.projectionAccess.kind, calls, ref, authenticated: access.filter(a => a.authenticated).map(a => a.account.userId), pending: pending.length }; runtime.dispose(); await runtime.repo.db.delete(); return output;
  });
  expect(result).toMatchObject({ readyWhileBlocked: false, ready: true, account: 'authenticated', calls: ['login-during-cleanup:unchanged-server-id'], ref: { kind: 'server', documentId: 'unchanged-server-id' }, authenticated: ['login-during-cleanup'], pending: 0 });
});
