import { expect, register, test } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('library thumbnails fill a responsive 2:3 frame across artwork sizes', async ({ page, server }) => {
  const sizes = { '001': [120, 180], '002': [160, 160], '003': [80, 180], '004': [180, 100] } as const;
  await page.route(/\/api\/v1\/documents\/book-00[1-4]\/cover$/, route => {
    const id = route.request().url().match(/book-(00[1-4])\/cover$/)![1] as keyof typeof sizes;
    const [width, height] = sizes[id];
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="navy"/></svg>` });
  });
  await page.route('**/api/v1/documents/book-005/cover', route => route.fulfill({ status: 404 }));
  await register(page, server.origin, 'cover-reader');
  const fallback = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Public book 05', exact: true }) }).locator('[class*="coverPlaceholder"]');
  await expect(fallback).toContainText('Public book 05');
  await expect(fallback).toContainText('Synthetic Author');
  await expect(fallback).toHaveCSS('background-image', /repeating-linear-gradient/);
  for (const viewport of [390, 1440]) {
    await page.setViewportSize({ width: viewport, height: 844 });
    for (const id of Object.keys(sizes)) {
      const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: `Public book ${id.slice(1)}`, exact: true }) });
      const artwork = card.locator('img');
      await expect(artwork).toHaveJSProperty('complete', true);
      await expect(artwork).toHaveCSS('object-fit', 'cover');
      expect(await artwork.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(sizes[id as keyof typeof sizes][0]);
      const box = (await artwork.boundingBox())!;
      expect(Math.abs(box.height - box.width * 1.5)).toBeLessThan(1);
    }
  }
});
