import { unlink, writeFile } from 'node:fs/promises';
import { test, expect, register } from './fixtures';

const ownedShell = `antholume-shell-${'0'.repeat(64)}`;

test('fresh visits install a public shell containing the lazy reader but no API responses', async ({ page, server }) => {
  await page.goto(`${server.origin}/login`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const paths = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const [key] = await caches.keys();
    return (await (await caches.open(key!)).keys()).map(request => new URL(request.url).pathname);
  });
  expect(paths).toContain('/');
  expect(paths.some(path => path.includes('ReaderRoute-') && path.endsWith('.js'))).toBe(true);
  expect(paths.every(path => path === '/' || path.startsWith('/assets/'))).toBe(true);
});

test('offline reloads enter the app on known routes but never serve the shell for API or unknown paths', async ({ page, context, server }) => {
  const user = 'offline-deep-link';
  await register(page, server.origin, user);
  await page.goto(server.origin + '/settings');
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: user, exact: true }).click();
  await expect(page).toHaveURL(server.origin + '/library');
  for (const path of ['/admin/logs/', '/insights/activity?day=2026-03-01']) {
    await page.goto(server.origin + path);
    await expect(page).toHaveURL(server.origin + '/library');
    await expect(page.getByRole('region', { name: 'Offline controls' })).toBeVisible();
  }
  for (const path of ['/api/v1/session', '/admin/unknown']) {
    await expect(page.goto(server.origin + path)).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
  }
});

test('Save to Device refuses an incomplete shell and repairs an evicted cache before reporting success', async ({ page, context, server }) => {
  const user = 'cache-repair-reader';
  await register(page, server.origin, user);
  const key = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const key = (await caches.keys()).find(name => /^antholume-shell-[a-f0-9]{64}$/.test(name))!;
    const cache = await caches.open(key);
    const reader = (await cache.keys()).find(request => request.url.includes('/ReaderRoute-') && request.url.endsWith('.js'))!;
    if (!await cache.delete(reader)) throw new Error('Reader asset was not cached');
    return key;
  });
  const card = page.getByRole('article').filter({ hasText: 'Public book 01' });
  async function save() {
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Save to Device' }).click();
  }
  await server.stop();
  await save();
  await expect(page.getByRole('alert')).toContainText('offline app is incomplete');
  await expect(card.getByRole('img', { name: 'Saved to device' })).toHaveCount(0);

  await page.evaluate(key => caches.delete(key), key);
  await server.start();
  await save();
  await expect(card.getByRole('img', { name: 'Saved to device' })).toBeVisible();
  await page.close();
  await server.stop();
  const cold = await context.newPage();
  await cold.goto(server.origin);
  await cold.getByRole('button', { name: user, exact: true }).click();
  await cold.getByRole('article').getByRole('link').click();
  await expect(cold.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
});

test('an existing root worker is upgraded after its clients close without removing book caches or unrelated caches', async ({ page, server }) => {
  test.setTimeout(60_000);
  const override = `${server.data}/legacy-worker`;
  await writeFile(override, "self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));");
  try {
    await page.goto(`${server.origin}/login`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${server.origin}/sw.js`);
    await page.evaluate(async owned => {
      await (await caches.open(owned)).put('/app/', new Response('old React shell'));
      await (await caches.open('OFFLINE_V1')).put('/documents/00000000000000000000000000000001/file', new Response('legacy EPUB'));
      await (await caches.open('antholume-shell-unrelated')).put('/keep', new Response('unrelated'));
    }, ownedShell);
  } finally { await unlink(override); }

  await page.goto(`${server.origin}/login`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
  await page.goto('about:blank');
  await page.goto(`${server.origin}/login`);
  await expect.poll(() => page.evaluate(() => caches.has('antholume-shell-' + '0'.repeat(64)))).toBe(false);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const state = await page.evaluate(async () => ({
    controller: navigator.serviceWorker.controller?.scriptURL ?? null,
    caches: await caches.keys(),
    cachedBook: await (await caches.match('/documents/00000000000000000000000000000001/file'))?.text(),
  }));
  expect(state.controller).toBe(`${server.origin}/sw.js`);
  expect(state.cachedBook).toBe('legacy EPUB');
  expect(state.caches.sort()).toEqual(['OFFLINE_V1', expect.stringMatching(/^antholume-shell-[a-f0-9]{64}$/), 'antholume-shell-unrelated']);
});
