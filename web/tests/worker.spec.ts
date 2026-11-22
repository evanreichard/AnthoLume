import { unlink, writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

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
