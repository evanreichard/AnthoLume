import { unlink, writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

const ownedShell = `antholume-shell-${'0'.repeat(64)}`;

test('fresh online React visits do not register a service worker or create a shell cache', async ({ page, server }) => {
  await page.goto(`${server.origin}/login`);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(async () => ({ scopes: (await navigator.serviceWorker.getRegistrations()).map(worker => worker.scope), caches: await caches.keys() }))).toEqual({ scopes: [], caches: [] });
});

test('an existing root worker is replaced and unregistered without removing book caches or unrelated caches', async ({ page, server }) => {
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
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const state = await page.evaluate(async () => ({
    controller: navigator.serviceWorker.controller?.scriptURL ?? null,
    caches: await caches.keys(),
    cachedBook: await (await caches.match('/documents/00000000000000000000000000000001/file'))?.text(),
  }));
  expect(state).toEqual({ controller: null, caches: ['OFFLINE_V1', 'antholume-shell-unrelated'], cachedBook: 'legacy EPUB' });
});
