import { test, expect, register, importBook, signIn, scratch } from './fixtures';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { pendingIds, serverEffects, storedRows } from './storage';

test('actual bootstrap, credentials, server paging, inert detail, URL sorting and compact native controls', async ({ page, server }) => {
  await register(page, server.origin, `layout-${Date.now()}`);
  await expect(page.getByRole('heading', { name: 'Public book 24', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Public book 25', exact: true })).toHaveCount(0);
  const loadMore = page.getByRole('button', { name: 'Load more shared books' });
  await loadMore.scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'Public book 30', exact: true })).toBeAttached();
  await expect(page.getByRole('article')).toHaveCount(30);
  await expect(loadMore).toHaveCount(0);
  const sort = page.getByRole('button', { name: 'Sort books' });
  await sort.click();
  await page.getByRole('button', { name: 'Author A–Z', exact: true }).click();
  await expect(page).toHaveURL(/sort=author/);
  await expect(sort).toBeFocused();
  await page.reload();
  await sort.click();
  await expect(page.getByRole('button', { name: 'Author A–Z', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(sort).toBeFocused();
  await page.goto(`${server.origin}/app/library?q=Public+book+01`);
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Read', exact: true })).toBeVisible();
  await expect(page.getByText('<script>window.__untrusted = true</script>', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => '__untrusted' in window)).toBe(false);
  await page.getByRole('main').getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/q=Public\+book\+01/);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const label of ['Add book', 'Sort books']) {
      const box = await page.getByRole('button', { name: label, exact: true }).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Insights', exact: true })).toHaveAttribute('href', '/app/insights');
});

test('real download, offline logout fencing, A to B to A and retained local identity', async ({ page, context, server }) => {
  const a = `privacy-a-${Date.now()}`;
  const b = `privacy-b-${Date.now()}`;
  await register(page, server.origin, a);
  await importBook(page, 'Private test local');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByText('✓ Available offline', { exact: true })).toBeVisible({ timeout: 30_000 });
  await context.clearCookies();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Sign in again', exact: true })).toBeVisible();
  await expect(page.getByText('✓ Available offline', { exact: true })).toBeVisible();
  await signIn(page, server.origin, a);
  await page.goto(`${server.origin}/app/offline`);
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.locator('article img')).toHaveCount(1);
  await page.getByRole('link', { name: 'More', exact: false }).first().click();
  await server.stop();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Private test local', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Public book 01', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Private test local', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Public book 01', exact: true })).toHaveCount(0);
  await expect(page.locator('article img')).toHaveCount(0);
  await server.start();
  await context.setOffline(false);
  await register(page, server.origin, b);
  await page.goto(`${server.origin}/app/offline`);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.locator('article img')).toHaveCount(0);
  await page.goto(`${server.origin}/app/more`);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, server.origin, a);
  await page.goto(`${server.origin}/app/offline`);
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.locator('article img')).toHaveCount(1);
});

test('root worker, complete hashed shell and a genuinely new offline browser process', async ({ server }) => {
  const profile = `${scratch}profile-${Date.now()}`;
  await mkdir(profile, { recursive: true });
  const options = { headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'], viewport: { width: 390, height: 844 } };
  let context = await chromium.launchPersistentContext(profile, options);
  let page = context.pages()[0];
  let bookURL = '';
  let readerURL = '';
  let checkpoint: unknown;
  let queued: string[] = [];
  const user = `cold-${Date.now()}`;
  try {
    await register(page, server.origin, user);
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    bookURL = page.url();
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(page.getByText('✓ Available offline', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${server.origin}/sw.js`);
    const worker = await page.request.get(`${server.origin}/sw.js`);
    expect(worker.status()).toBe(200);
    expect(worker.headers()['content-type']).toMatch(/javascript/);
    expect(await worker.text()).toContain('self.__ANTHOLUME_PRECACHE__=');
  } finally { await context.close(); }
  await server.stop();
  context = await chromium.launchPersistentContext(profile, { ...options, offline: true });
  page = context.pages()[0];
  try {
    await page.goto(bookURL);
    await expect(page.getByRole('heading', { name: 'Public book 01', exact: true })).toBeVisible();
    await expect(page.getByText('✓ Available offline', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Resume', exact: true }).click();
    await expect(page.locator('iframe').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Public chapter', exact: true })).toBeVisible();
    readerURL = page.url();
    await page.waitForTimeout(15_000);
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.locator('footer')).toContainText('2 /');
    await expect.poll(async () => (await storedRows(page, 'events')).filter((row) => row.kind === 'activity').length).toBe(1);
    queued = await pendingIds(page);
    expect(queued.length).toBeGreaterThanOrEqual(2);
    checkpoint = (await storedRows(page, 'books'))[0].checkpoint;
  } finally { await context.close(); }
  context = await chromium.launchPersistentContext(profile, { ...options, offline: true });
  page = context.pages()[0];
  try {
    await page.goto(readerURL);
    await expect(page.locator('iframe').first()).toBeVisible();
    await writeFile(`${scratch}cold-restore.json`, JSON.stringify({ checkpoint, restored: (await storedRows(page, 'books'))[0].checkpoint, footer: await page.locator('footer').textContent(), queued, actualPending: await pendingIds(page) }, null, 2));
    const position = (checkpoint as { position: string }).position;
    const paragraph = position.match(/\/p\[(\d+)\]$/);
    expect(paragraph).not.toBeNull();
    await expect(page.frameLocator('iframe').first().locator('body p').nth(Number(paragraph![1]) - 1)).toBeInViewport();
    expect((await storedRows(page, 'books'))[0].checkpoint).toEqual(checkpoint);
    expect(await pendingIds(page)).toEqual(queued);
    expect(serverEffects(server.data, user).activity).toBe(0);
    await server.start();
    await context.setOffline(false);
    await page.goto(`${server.origin}/app/sync`);
    await expect.poll(() => pendingIds(page)).toEqual([]);
    const effects = serverEffects(server.data, user);
    expect(effects.activity).toBe(1);
    expect(effects.receipts.length).toBe(queued.length);
    const accepted = effects.receipts.map((receipt) => receipt.event_id).sort();
    expect(accepted).toEqual([...queued].sort());
    await page.getByRole('button', { name: 'Retry synchronization' }).click();
    await page.reload();
    await expect(page.getByText('0 pending events.', { exact: false })).toBeVisible();
    expect(serverEffects(server.data, user)).toEqual(effects);
  } finally { await context.close(); }
});
