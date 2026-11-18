import { writeFile, unlink } from 'node:fs/promises';
import { test, expect, register, importBook } from './fixtures';
import { pendingIds, storedRows } from './storage';

async function marker(page: import('@playwright/test').Page) {
  return page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('antholume-app-control-v1');
    request.onupgradeneeded = () => { request.transaction?.abort(); resolve(null); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('meta', 'readonly');
      const value = tx.objectStore('meta').get('retirement/legacy-v1');
      tx.oncomplete = () => { db.close(); resolve(value.result); };
      tx.onerror = () => reject(tx.error);
    };
  }));
}

test('actual legacy root worker retirement preserves new books/events and unrelated storage, then leaves fresh SSR links usable', async ({ page, context, server }) => {
  test.setTimeout(90_000);
  await register(page, server.origin, `retirement-${Date.now()}`);
  await importBook(page, 'Retained local original');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByText('✓ Available offline', { exact: true })).toBeVisible();
  await server.stop();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await expect(page.locator('footer')).toContainText('1 /');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(async () => (await pendingIds(page)).length).toBe(1);
  const queued = await pendingIds(page);
  const books = (await storedRows(page, 'books')).map((row) => row.checkpoint);
  await page.close();
  await context.clearCookies();
  await server.start();
  await context.setOffline(false);
  await writeFile(`${server.data}/legacy-worker`, 'actual assets/sw.js');
  let legacy = await context.newPage();
  try {
    await legacy.goto(`${server.origin}/login`);
    await legacy.evaluate(async () => { await (await navigator.serviceWorker.getRegistration('/'))!.update(); });
    await expect.poll(() => legacy.evaluate(async () => (await navigator.serviceWorker.getRegistration('/'))?.waiting?.state)).toBe('installed');
    await legacy.close();
    await new Promise((resolve) => setTimeout(resolve, 500));
    legacy = await context.newPage();
    await legacy.goto(`${server.origin}/login`);
    await expect.poll(() => legacy.evaluate(() => new Promise<unknown>((resolve) => {
      const id = crypto.randomUUID();
      const listener = (event: MessageEvent) => { if (event.data?.id === id) { navigator.serviceWorker.removeEventListener('message', listener); resolve(event.data.data); } };
      navigator.serviceWorker.addEventListener('message', listener);
      navigator.serviceWorker.controller?.postMessage({ id, data: { type: 'GET_SW_VERSION' } });
      setTimeout(() => { navigator.serviceWorker.removeEventListener('message', listener); resolve(null); }, 500);
    }))).toBe(1);
    await legacy.evaluate(async () => {
      localStorage.setItem('readerSettings', 'legacy'); localStorage.setItem('unrelated-setting', 'keep');
      const unrelated = await caches.open('unrelated-cache'); await unrelated.put('/unrelated-preserve', new Response('keep'));
      const old = await caches.open('OFFLINE_V1'); await old.put('/legacy-preserve-until-retirement', new Response('legacy'));
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('keyval-store', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('keyval');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('keyval', 'readwrite'), store = tx.objectStore('keyval');
          for (const key of ['ACTIVITY', `FILE-${'a'.repeat(32)}`, `FILE-METADATA-${'a'.repeat(32)}`, `PROGRESS-${'a'.repeat(32)}`]) store.put('legacy', key);
          store.put('keep', 'unrelated-key'); store.put('keep', 'FILE-not-a-protocol-id');
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
        };
      });
      // Lost Control Marker - Existing new reader records must survive the fixed legacy allowlist on recovery.
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('antholume-app-control-v1');
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('meta', 'readwrite');
          tx.objectStore('meta').delete('retirement/legacy-v1');
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
        };
      });
    });
    await unlink(`${server.data}/legacy-worker`);
    await legacy.goto(`${server.origin}/app/library`);
    await expect(legacy.getByRole('heading', { name: 'Retained local original', exact: true })).toBeVisible({ timeout: 35_000 });
    await expect.poll(async () => (await marker(legacy) as { phase: string })?.phase, { timeout: 35_000 }).toBe('done');
    expect(await pendingIds(legacy)).toEqual(queued);
    expect((await storedRows(legacy, 'books')).map((row) => row.checkpoint)).toEqual(books);
    const state = await legacy.evaluate(async () => {
      const keys = await new Promise<IDBValidKey[]>((resolve) => {
        const request = indexedDB.open('keyval-store'); request.onsuccess = () => {
          const db = request.result, tx = db.transaction('keyval'), result = tx.objectStore('keyval').getAllKeys();
          tx.oncomplete = () => { db.close(); resolve(result.result); };
        };
      });
      return { caches: await caches.keys(), keys, preferences: localStorage.getItem('readerSettings'), unrelated: localStorage.getItem('unrelated-setting') };
    });
    expect(state.caches).not.toContain('OFFLINE_V1');
    expect(state.caches).toContain('unrelated-cache');
    expect(state.keys.sort()).toEqual(['FILE-not-a-protocol-id', 'unrelated-key']);
    expect(state.preferences).toBeNull(); expect(state.unrelated).toBe('keep');
    await legacy.goto(`${server.origin}/login`);
    await expect(legacy).toHaveURL(`${server.origin}/login`);
    await legacy.waitForTimeout(500);
    await expect(legacy).toHaveURL(`${server.origin}/login`);
  } finally { await unlink(`${server.data}/legacy-worker`).catch(() => undefined); await legacy.close(); }
});

test('a failed complete-shell install preserves the real legacy controller/cache and offers explicit recovery', async ({ page, server }) => {
  test.setTimeout(60_000);
  await writeFile(`${server.data}/legacy-worker`, 'actual legacy source');
  try {
    await page.goto(`${server.origin}/login`);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${server.origin}/sw.js`);
    await page.evaluate(async () => {
      const old = await caches.open('OFFLINE_V1'); await old.put('/failure-sentinel', new Response('preserve'));
      localStorage.setItem('readerSettings', 'legacy-preserved-on-failure');
    });
    await writeFile(`${server.data}/fail-shell`, 'deny a real lazy reader chunk');
    await unlink(`${server.data}/legacy-worker`);
    await page.goto(`${server.origin}/app/offline`);
    await expect(page.getByRole('button', { name: 'Retry update / recovery', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Import local EPUB', exact: true })).toBeDisabled();
    const preserved = await page.evaluate(async () => ({
      old: await (await caches.open('OFFLINE_V1')).match('/failure-sentinel').then(async (response) => response?.text()),
      settings: localStorage.getItem('readerSettings'),
      waiting: !!(await navigator.serviceWorker.getRegistration('/'))?.waiting,
    }));
    expect(preserved).toEqual({ old: 'preserve', settings: 'legacy-preserved-on-failure', waiting: false });
    expect((await marker(page) as { phase?: string } | undefined)?.phase).not.toBe('done');
    await unlink(`${server.data}/fail-shell`);
    await page.getByRole('button', { name: 'Retry update / recovery', exact: true }).click();
    const recovery = page.getByRole('region', { name: 'App update and recovery', exact: true }).getByRole('button', { name: /^(Update app|Retry update \/ recovery)$/ });
    await expect(recovery).toBeEnabled({ timeout: 15_000 });
    await recovery.click();
    await expect(page.getByRole('button', { name: 'Import local EPUB', exact: true })).toBeEnabled({ timeout: 20_000 });
    await expect.poll(async () => (await marker(page) as { phase?: string })?.phase).toBe('done');
  } finally {
    await unlink(`${server.data}/legacy-worker`).catch(() => undefined);
    await unlink(`${server.data}/fail-shell`).catch(() => undefined);
  }
});
