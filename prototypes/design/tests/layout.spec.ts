import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const routes = [
  '/library',
  '/books/tidal',
  '/read/tidal',
  '/offline',
  '/insights',
  '/more',
  '/sync?state=conflict',
];
for (const direction of ['folio', 'index']) {
  for (const theme of ['light', 'dark']) {
    for (const width of [320, 390, 1280]) {
      test(`${direction} ${theme} ${width}px: routes reflow without horizontal overflow`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 844 });
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        for (const route of routes) {
          await page.goto(`/?direction=${direction}&theme=${theme}#${route}`);
          await expect(page.locator('[data-route-heading]').last()).toBeVisible();
          const dimensions = await page.evaluate(() => ({
            width: innerWidth,
            content: document.documentElement.scrollWidth,
          }));
          expect(dimensions.content, route).toBeLessThanOrEqual(dimensions.width);
          if (width === 1280 && route !== '/read/tidal')
            await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
          if (width === 1280 && route === '/books/tidal')
            await expect(page.getByRole('region', { name: 'Book library' })).toBeVisible();
          if (width < 700 && route !== '/read/tidal')
            await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
        }
        expect(errors).toEqual([]);
      });
    }
  }
}

for (const direction of ['folio', 'index']) {
  test(`${direction}: review screenshots and no external resource requests`, async ({
    page,
    baseURL,
  }) => {
    const directory = resolve(
      process.env.M2_SCREENSHOT_DIR || '../../_scratch/m2/design/screenshots',
    );
    await mkdir(directory, { recursive: true });
    const allowedOrigin = new URL(baseURL!).origin;
    const external: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== allowedOrigin) external.push(request.url());
    });
    for (const theme of ['light', 'dark']) {
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: width === 1280 ? 960 : 844 });
        await page.goto(`/?direction=${direction}&theme=${theme}#/library`);
        await page.screenshot({ path: `${directory}/${direction}-${theme}-${width}-library.png` });
        await page.screenshot({
          path: `${directory}/${direction}-${theme}-${width}-library-full.png`,
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [name, route] of [
      ['detail', '/books/tidal'],
      ['reader', '/read/tidal'],
      ['offline', '/offline'],
      ['conflict', '/sync?state=conflict'],
    ]) {
      await page.goto(`/?direction=${direction}&theme=light#${route}`);
      await page.screenshot({ path: `${directory}/${direction}-light-390-${name}.png` });
      await page.screenshot({
        path: `${directory}/${direction}-light-390-${name}-full.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(`/?direction=${direction}&theme=light#/books/tidal`);
    await page.screenshot({ path: `${directory}/${direction}-light-320-detail.png` });
    await page.screenshot({
      path: `${directory}/${direction}-light-320-detail-full.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 960 });
    await page.goto(`/?direction=${direction}&theme=light#/books/tidal`);
    await page.screenshot({ path: `${directory}/${direction}-light-1280-detail.png` });
    await page.screenshot({
      path: `${directory}/${direction}-light-1280-detail-full.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?direction=${direction}&theme=light#/more`);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('button', { name: 'Sign out · retain downloads' }).click();
    await page.evaluate(() => {
      location.hash = '/sync?state=conflict';
    });
    await expect(page.getByRole('heading', { name: 'Account events paused' })).toBeVisible();
    await page.screenshot({ path: `${directory}/${direction}-light-390-logged-out-sync.png` });
    await page.screenshot({
      path: `${directory}/${direction}-light-390-logged-out-sync-full.png`,
      fullPage: true,
    });
    expect(external).toEqual([]);
  });
}

test('320px dialog reflow at large text and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?direction=folio#/read/tidal');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('slider', { name: 'Text size' }).fill('28');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(
    await page.getByRole('dialog').evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
