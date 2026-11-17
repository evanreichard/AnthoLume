import { expect, test } from '@playwright/test';
test('denied page cleanup cannot mark retirement done; explicit reload recovers without clearing unrelated storage', async ({ page, request }) => {
  await request.get('/__test/mode?worker=new');
  await page.addInitScript(() => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) { if (key === 'readerSettings' && sessionStorage.getItem('test:deny-cleanup') !== 'off') throw new DOMException('Denied cleanup', 'SecurityError'); return remove.call(this, key); };
    if (sessionStorage.getItem('test:deny-cleanup') !== 'off') localStorage.setItem('readerSettings', 'legacy'); localStorage.setItem('unrelated', 'keep');
  });
  await page.goto('/app/');
  await expect(page.getByRole('region', { name: 'App update and recovery', exact: true }).getByText(/Update could not complete/)).toBeVisible();
  const marker = () => page.evaluate(async () => new Promise<{ phase: string }>((resolve, reject) => { const r = indexedDB.open('antholume-app-control-v1'); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result, q = db.transaction('meta').objectStore('meta').get('retirement/legacy-v1'); q.onsuccess = () => resolve(q.result); q.transaction!.oncomplete = () => db.close(); }; }));
  expect((await marker()).phase).toBe('cleaning');
  expect(await page.evaluate(() => localStorage.getItem('unrelated'))).toBe('keep');
  await page.evaluate(() => sessionStorage.setItem('test:deny-cleanup', 'off'));
  await page.waitForTimeout(31000);
  await page.reload(); await expect.poll(async () => (await marker()).phase).toBe('done');
  expect(await page.evaluate(() => localStorage.getItem('readerSettings'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('unrelated'))).toBe('keep');
});
test('nonce/schema handshake rejects malformed clients and stale control fences cannot commit completion', async ({ page, request }) => {
  await request.get('/__test/mode?worker=new'); await page.goto('/app/');
  await expect(page.getByText('Opening your stored library…')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const result = await page.evaluate(async () => {
    const worker = navigator.serviceWorker.controller!;
    const send = (data: unknown) => new Promise<Record<string, unknown>>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = e => { channel.port1.close(); resolve(e.data); }; worker.postMessage(data, [channel.port2]); });
    const bad = await send({ type: 'APP_HELLO', nonce: 'bad-schema', protocol: 1, schema: 99, events: 1, reading: false, busy: false });
    const stale = await send({ type: 'APP_READY', nonce: 'stale-owner', marker: { key: 'retirement/legacy-v1', epoch: 1, owner: 'stale', fence: 0, until: Date.now() + 30000, build: bad.build, phase: 'cleaning' } });
    return { bad: bad.type, stale: stale.type, nonce: bad.nonce, legacyStillGone: !(await caches.keys()).includes('OFFLINE_V1') };
  });
  expect(result).toEqual({ bad: 'APP_ERROR', stale: 'APP_ERROR', nonce: 'bad-schema', legacyStillGone: true });
});
