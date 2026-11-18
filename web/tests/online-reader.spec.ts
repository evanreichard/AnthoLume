import { readFile } from 'node:fs/promises';
import { epub, expect, register, test } from './fixtures';

test('Read opens online and revalidates the browser EPUB cache without transferring it again', async ({ page, server }) => {
  await register(page, server.origin, 'online-reader');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  const reader = page.getByRole('region', { name: 'Book reader', exact: true });
  for (const status of [200, 304]) {
    const file = page.waitForResponse(response => /\/api\/v1\/documents\/[^/]+\/file$/.test(response.url()));
    await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
    expect((await file).status()).toBe(status);
    await expect(reader).toHaveAttribute('data-reader-state', 'ready');
    await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Public chapter' })).toBeVisible();
    await page.goBack();
  }
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
});

test('saved theme is already active while the EPUB is downloading', async ({ page, context, server }) => {
  await register(page, server.origin, 'themed-reader');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('antholume-reading-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key: 'appearance', value: { theme: 'black', font: 'serif', size: 100 } });
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 1024, uploadThroughput: -1 });
  try {
    await page.getByRole('link', { name: 'Read', exact: true }).click();
    const progress = page.getByRole('progressbar', { name: 'EPUB download progress' });
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute('max', /[1-9]\d*/);
    await expect(page.getByRole('region', { name: 'Book reader' })).toHaveCSS('background-color', 'rgb(18, 18, 18)');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#121212');
  } finally { await cdp.detach(); }
  await expect(page.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
  await expect(page.frameLocator('iframe').locator('body')).toHaveCSS('background-color', 'rgb(18, 18, 18)');
});

test('existing local originals are exportable without signing in and are not removed', async ({ page, server }) => {
  await page.goto(`${server.origin}/app/login`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const original = await epub('Local export');
  await page.evaluate(async bytes => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('antholume-reading-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('books', 'readwrite');
        tx.objectStore('books').put({ key: '["local","export-test"]', scope: 'local', ref: { kind: 'local', localId: 'export-test' }, title: 'Local export', author: null, cover: null, availability: 'available', checkpoint: { position: null, fraction: null }, bytes: new Blob([new Uint8Array(bytes)]) });
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, [...original]);
  await page.goto(`${server.origin}/app/offline`);
  await expect(page.getByRole('heading', { name: 'Export local books' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Local export' }).click();
  expect(await readFile((await (await download).path())!)).toEqual(original);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Export Local export' })).toBeVisible();
});
