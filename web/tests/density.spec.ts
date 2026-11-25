import { test, expect, register } from './fixtures';
import { pendingIds, serverEffects } from './storage';

test.use({ hasTouch: true });

test('online reader checkpoint drives compact Folio Resume, density and touch', async ({ page, server }, testInfo) => {
  const user = 'compact-online';
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('link', { name: 'Read', exact: true }).click();
  await expect(
    page.frameLocator('iframe').first().getByRole('heading', { name: 'Public chapter', exact: true }),
  ).toBeVisible();
  let releaseProgress!: () => void;
  const progressAllowed = new Promise<void>((resolve) => {
    releaseProgress = resolve;
  });
  await page.route('**/api/v1/me/reading-progress', async (route) => {
    if (new URL(route.request().frame().url()).pathname !== '/library') return route.abort();
    await progressAllowed;
    await route.continue();
  });
  await page.keyboard.press('c');
  await page.getByRole('button', { name: 'Next Page', exact: true }).click();
  await expect(page.locator('footer')).toContainText('2 /');
  await page.keyboard.press('c');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Resume', exact: true })).toBeVisible();
  const [eventId] = await pendingIds(page);
  expect(eventId).toBeTruthy();

  let releaseStaleListing!: () => void;
  const staleListingHeld = new Promise<void>((resolve) => {
    releaseStaleListing = resolve;
  });
  await page.route(
    (url) => url.pathname === '/api/v1/documents' && url.searchParams.get('resumable') === 'true',
    async (route) => {
      const stale = await route.fetch();
      expect(stale.ok()).toBe(true);
      expect((await stale.json()).items).toEqual([]);
      // First Load - Keep the empty result in flight while replay commits, before the query has any cached data.
      releaseProgress();
      await staleListingHeld;
      await route.fulfill({ response: stale });
    },
    { times: 1 },
  );
  const feature = page.getByRole('region', { name: 'Continue reading', exact: true });
  try {
    await page.goto(`${server.origin}/library`);
    await expect
      .poll(() => serverEffects(server.data, user).receipts)
      .toMatchObject([{ event_id: eventId, kind: 'progress', status: 200 }]);
    await expect.poll(() => pendingIds(page)).toEqual([]);
    await expect(feature.getByRole('link', { name: 'Resume', exact: true })).toBeVisible();
  } finally {
    releaseProgress();
    releaseStaleListing();
  }
  await expect(page.getByRole('button', { name: 'Add Book', exact: true })).toBeEnabled();
  for (const [width, height] of [
    [320, 844],
    [390, 844],
    [844, 390],
    [1280, 900],
  ]) {
    await page.setViewportSize({ width, height });
    const resume = await feature.boundingBox();
    const search = await page.getByRole('search').boundingBox();
    const first = await page.getByRole('article').first().boundingBox();
    expect(resume!.y + resume!.height).toBeLessThanOrEqual(search!.y);
    expect(first!.y).toBeLessThan(width < 760 ? 420 : 500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const label of ['Add Book', 'Sort Books', 'Search']) {
      const box = await page.getByRole('button', { name: label, exact: true }).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      if (label !== 'Search') expect(box!.y).toBe(search!.y);
    }
    if (width === 320) {
      await page.getByRole('button', { name: 'Add Book', exact: true }).tap();
      const dialog = page.getByRole('dialog', { name: 'Add Book' });
      await expect(dialog.getByLabel('Choose EPUB to upload')).toBeVisible();
      await dialog.getByRole('button', { name: 'Done' }).tap();
      await expect(dialog).toHaveCount(0);
    }
    await page.screenshot({ path: testInfo.outputPath(`folio-${width}.png`), fullPage: true });
  }
  await expect(feature.getByRole('heading', { name: 'Public book 01', exact: true })).toBeVisible();
  expect(serverEffects(server.data, user).head?.revision).toBe(1);
});
