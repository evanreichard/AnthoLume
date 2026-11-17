import { test, expect, importBook, scratch } from './fixtures';
import { storedRows } from './storage';

test('actual local reader checkpoint drives compact Folio Resume, provenance, density and touch without server events', async ({ page, server }) => {
  const outgoing: string[] = [];
  page.on('request', (request) => { if (/\/api\/v1\/me\/(activity|reading-progress|devices)$/.test(request.url())) outgoing.push(request.url()); });
  await page.goto(`${server.origin}/app/library`);
  await importBook(page, 'Compact original');
  await page.getByRole('heading', { name: 'Compact original', exact: true }).click();
  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Public chapter', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('footer')).toContainText('2 /');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Resume', exact: true })).toBeVisible();
  await page.goto(`${server.origin}/app/library`);
  const feature = page.getByRole('region', { name: 'Continue reading', exact: true });
  await expect(feature.getByRole('link', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add book', exact: true })).toBeEnabled();
  for (const [width, height] of [[320, 844], [390, 844], [844, 390], [1280, 900]]) {
    await page.setViewportSize({ width, height });
    const resume = await feature.boundingBox();
    const search = await page.getByRole('search').boundingBox();
    const first = await page.getByRole('article').first().boundingBox();
    expect(resume!.y + resume!.height).toBeLessThanOrEqual(search!.y);
    expect(first!.y).toBeLessThan(width < 760 ? 420 : 500);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const label of ['Add book', 'Filter books', 'Search']) {
      const box = await page.getByRole('button', { name: label, exact: true }).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
      if (label !== 'Search') expect(box!.y).toBe(search!.y);
    }
    await page.screenshot({ path: `${scratch}folio-${width}.png`, fullPage: true });
  }
  await expect(page.getByRole('img', { name: 'Local-only book', exact: true })).toHaveCount(2);
  await expect(page.getByText('✓ Available offline', { exact: true })).toHaveCount(1);
  expect(await storedRows(page, 'events')).toEqual([]);
  expect(outgoing).toEqual([]);
});
