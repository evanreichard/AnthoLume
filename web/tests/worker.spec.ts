import { unlink, writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

const ownedShell = `antholume-shell-${'0'.repeat(64)}`;

test('fresh online React visits do not register a service worker or create a shell cache', async ({ page, server }) => {
  await page.goto(`${server.origin}/app/login`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(async () => ({ scopes: (await navigator.serviceWorker.getRegistrations()).map(worker => worker.scope), caches: await caches.keys() }))).toEqual({ scopes: [], caches: [] });
});

test('an existing root worker is replaced and unregistered without removing books or unrelated storage', async ({ page, server }) => {
  test.setTimeout(60_000);
  const override = `${server.data}/legacy-worker`;
  await writeFile(override, 'actual assets/sw.js');
  try {
    await page.goto(`${server.origin}/login`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${server.origin}/sw.js`);
    await page.evaluate(async owned => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('keyval-store');
        request.onupgradeneeded = () => request.result.createObjectStore('keyval');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('keyval', 'readwrite');
        transaction.objectStore('keyval').put(new Blob(['original book']), 'LOCAL_BOOK');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
      await (await caches.open(owned)).put('/app/', new Response('old React shell'));
      await (await caches.open('OFFLINE_V1')).put('/documents/00000000000000000000000000000001/file', new Response('legacy EPUB'));
      await (await caches.open('antholume-shell-unrelated')).put('/keep', new Response('unrelated'));
    }, ownedShell);
  } finally { await unlink(override); }

  await page.goto(`${server.origin}/app/login`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const state = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const book = await new Promise<Blob>((resolve, reject) => {
      const request = db.transaction('keyval').objectStore('keyval').get('LOCAL_BOOK');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return { controller: navigator.serviceWorker.controller?.scriptURL ?? null, caches: await caches.keys(), book: await book.text(), cachedBook: await (await caches.match('/documents/00000000000000000000000000000001/file'))?.text() };
  });
  expect(state).toEqual({ controller: null, caches: ['OFFLINE_V1', 'antholume-shell-unrelated'], book: 'original book', cachedBook: 'legacy EPUB' });
});
