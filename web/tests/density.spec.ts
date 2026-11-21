import { test, expect, register, scratch } from './fixtures';
import { serverEffects } from './storage';

test.use({ hasTouch: true });

test('online reader checkpoint drives compact Folio Resume, density and touch', async ({ page, server }) => {
  const outgoing: string[] = [];
  page.on('request', (request) => { if (/\/api\/v1\/me\/(activity|reading-progress|devices)$/.test(request.url())) outgoing.push(request.url()); });
  await register(page, server.origin, 'compact-online');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('link', { name: 'Read', exact: true }).click();
  await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Public chapter', exact: true })).toBeVisible();
  await page.keyboard.press('c');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('footer')).toContainText('2 /');
  await page.keyboard.press('c');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Resume', exact: true })).toBeVisible();
  await page.goto(`${server.origin}/library`);
  const feature = page.getByRole('region', { name: 'Continue reading', exact: true });
  await expect(feature.getByRole('link', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Book', exact: true })).toBeEnabled();
  for (const [width, height] of [[320, 844], [390, 844], [844, 390], [1280, 900]]) {
    await page.setViewportSize({ width, height });
    const resume = await feature.boundingBox();
    const search = await page.getByRole('search').boundingBox();
    const first = await page.getByRole('article').first().boundingBox();
    expect(resume!.y + resume!.height).toBeLessThanOrEqual(search!.y);
    expect(first!.y).toBeLessThan(width < 760 ? 420 : 500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const label of ['Add Book', 'Sort Books', 'Search']) {
      const box = await page.getByRole('button', { name: label, exact: true }).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
      if (label !== 'Search') expect(box!.y).toBe(search!.y);
    }
    if (width === 320) {
      await page.getByRole('button', { name: 'Add Book', exact: true }).tap();
      const dialog = page.getByRole('dialog', { name: 'Add Book' });
      await expect(dialog.getByLabel('Choose EPUB to upload')).toBeVisible();
      await dialog.getByRole('button', { name: 'Done' }).tap();
      await expect(dialog).toHaveCount(0);
    }
    await page.screenshot({ path: `${scratch}folio-${width}.png`, fullPage: true });
  }
  await expect(feature.getByRole('heading', { name: 'Public book 01', exact: true })).toBeVisible();
  await expect.poll(() => serverEffects(server.data, 'compact-online').head?.revision).toBe(1);
  expect(outgoing.some(url => url.endsWith('/reading-progress'))).toBe(true);
});
