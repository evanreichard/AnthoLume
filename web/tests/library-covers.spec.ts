import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { expect, register, test } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('missing server files are flagged on the cover and book detail', async ({ page, server }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await register(page, server.origin, 'missing-file-reader');
  const endpoint = `${server.origin}/api/v1`;
  const { csrf_token, user } = await (await page.request.get(`${endpoint}/session`)).json();
  const headers = { Origin: server.origin, 'X-CSRF-Token': csrf_token, 'X-AnthoLume-Reading-Generation': user.reading_generation };
  const device_id = 'missing-file-device';
  expect((await page.request.post(`${endpoint}/me/devices`, { headers, data: { id: device_id, name: 'Reader' } })).status()).toBe(200);
  expect((await page.request.post(`${endpoint}/me/reading-progress`, { headers, data: {
    event_id: randomUUID(), document_id: 'book-001', device_id, base_revision: '0', observed_at: new Date().toISOString(), position: '/body/DocFragment[1]/body/p[2]', fraction: .54,
  } })).status()).toBe(200);
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Public book 01', exact: true }) });
  const link = card.getByRole('link');
  const file = `${server.data}/documents/public.epub`;
  const warning = card.getByRole('img', { name: 'Book file unavailable' });
  await expect(warning).toHaveCount(0);
  await rename(file, `${file}.missing`);
  await page.reload();
  await expect(warning).toBeVisible();
  await expect(link).toHaveAccessibleDescription('Book file unavailable');
  await expect(card.locator('img')).toBeVisible();
  await card.screenshot({ path: testInfo.outputPath('missing-cover-320.png') });
  await link.click();
  const hero = page.getByRole('region', { name: 'Public book 01', exact: true });
  const status = page.getByRole('status').filter({ hasText: 'Book file unavailable' });
  await expect(status).toContainText('The server can’t find or read this file.');
  await expect(hero).not.toContainText('Book file unavailable');
  await expect(hero.getByText('54%', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Reading progress' })).toContainText('54%');
  await expect(page.getByRole('link', { name: /^(Read|Resume)$/ })).toHaveCount(0);
  for (const [width, colorScheme] of [[320, 'light'], [1440, 'dark']] as const) {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ colorScheme });
    const [heroBox, statusBox] = await Promise.all([hero.boundingBox(), status.boundingBox()]);
    expect(statusBox!.y).toBeGreaterThan(heroBox!.y + heroBox!.height);
    expect(statusBox!.width).toBeCloseTo(heroBox!.width);
    const [icon, text] = await Promise.all([status.locator('svg').boundingBox(), status.locator('p').boundingBox()]);
    expect(icon!.y + icon!.height / 2).toBeCloseTo(text!.y + text!.height / 2, 0);
    await page.screenshot({ path: testInfo.outputPath(`missing-detail-${width}.png`) });
  }
  await rename(`${file}.missing`, file);
  await page.reload();
  await expect(page.getByRole('link', { name: 'Resume', exact: true })).toBeVisible();
  await expect(hero).toContainText('54%');
  await expect(status).toHaveCount(0);
});

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
