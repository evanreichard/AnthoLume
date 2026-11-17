import { expect, test, type Locator, type Page } from '@playwright/test';

async function open(page: Page, route: string, width: number, height = 844) {
  await page.setViewportSize({ width, height });
  await page.goto(`/?direction=folio&theme=light#${route}`);
}
async function bounds(element: Locator) {
  const box = await element.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}
async function touch(element: Locator) {
  const box = await bounds(element);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  return box;
}
async function compactLibrary(page: Page, maxFirstY: number) {
  const feature = await bounds(page.getByRole('region', { name: 'Continue reading' }));
  const row = await bounds(page.locator('.library-search-row'));
  const filter = await touch(page.getByRole('button', { name: 'Filter library', exact: true }));
  const add = await touch(page.getByRole('button', { name: 'Add local sample', exact: true }));
  expect(feature.y + feature.height).toBeLessThanOrEqual(row.y);
  expect(feature.height).toBeLessThanOrEqual(page.viewportSize()!.width >= 1200 ? 210 : 125);
  expect(add.x).toBeGreaterThan(filter.x);
  expect(Math.abs(add.y - filter.y)).toBeLessThan(2);
  expect(Math.abs(row.y - add.y)).toBeLessThan(2);
  expect(
    await page
      .getByRole('button', { name: 'Add local sample' })
      .evaluate((button) => Boolean(button.closest('.library-search-row'))),
  ).toBe(true);
  await expect(page.getByRole('button', { name: 'Add local sample' })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Resume', exact: true })).toHaveCount(1);
  await touch(page.getByRole('link', { name: 'Resume', exact: true }));
  await expect(page.getByRole('link', { name: 'Resume reading', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'On the shelves', exact: true })).toHaveCount(0);
  await expect(page.locator('.source-legend')).toHaveCount(0);
  const divider = await bounds(page.getByRole('separator', { name: 'Library results' }));
  expect(divider.height).toBeLessThanOrEqual(1);
  expect(divider.y).toBeGreaterThanOrEqual(row.y + row.height);
  const first = await bounds(page.locator('.book-card').first());
  expect(first.y).toBeGreaterThan(divider.y);
  expect(first.y - divider.y).toBeLessThanOrEqual(16);
  expect(first.y).toBeLessThanOrEqual(maxFirstY);
  await expect(page.locator('.book-card')).toHaveCount(5);
  await expect(
    page.locator('.book-card').getByRole('img', { name: 'Source: Local original' }),
  ).toHaveAttribute('title', 'Local original');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  return first;
}
async function compactReader(page: Page, minimumPageHeight: number) {
  const header = await bounds(page.locator('.page-reader-header'));
  const footer = await bounds(page.locator('.page-reader-footer'));
  expect(header.height).toBeLessThanOrEqual(50);
  expect(footer.height).toBeLessThanOrEqual(
    page.viewportSize()!.width < 1000 && page.viewportSize()!.height > 480 ? 95 : 50,
  );
  expect((await bounds(page.locator('.page-window'))).height).toBeGreaterThanOrEqual(
    minimumPageHeight,
  );
  await touch(page.getByRole('button', { name: 'Appearance', exact: true }));
  await touch(page.getByRole('button', { name: 'Contents', exact: true }));
  await touch(page.getByRole('button', { name: 'Next', exact: true }));
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('slider', { name: 'Text size' }).fill('26');
  await page.getByRole('button', { name: 'Ink', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('article.page-text')).toHaveCSS('font-size', '26px');
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Paper', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('article.page-text')).toHaveCSS('font-size', '26px');
  await expect
    .poll(() =>
      page
        .locator('article.page-text')
        .evaluate(
          (element) =>
            element.scrollHeight <= element.clientHeight &&
            element.scrollWidth <= element.clientWidth &&
            document.documentElement.scrollHeight <= innerHeight &&
            scrollY === 0,
        ),
    )
    .toBe(true);
}

for (const width of [320, 390]) {
  test(`Folio density ${width}: feature first, one query/action row, divider and earlier complete first item`, async ({
    page,
  }) => {
    await open(page, '/library', width);
    const first = await compactLibrary(page, 350);
    const tabs = await bounds(page.getByRole('navigation', { name: 'Mobile navigation' }));
    expect(first.y + first.height).toBeLessThan(tabs.y);
    expect((await bounds(page.locator('.book-cover-area').first())).height).toBeLessThanOrEqual(
      210,
    );
    const add = page.getByRole('button', { name: 'Add local sample' });
    await add.click();
    await expect(page.getByRole('dialog', { name: 'Import a local book' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(add).toBeFocused();
    await page.getByRole('searchbox').fill('Field');
    await expect(page.getByRole('region', { name: 'Continue reading' })).toHaveCount(0);
    expect((await bounds(page.locator('.library-search-row'))).y).toBeLessThan(170);
    await expect(page.locator('.book-card')).toHaveCount(1);
  });
  test(`Folio density ${width}: detail Resume is early, legible and still a full touch target`, async ({
    page,
  }) => {
    await open(page, '/books/tidal', width);
    const action = await touch(page.getByRole('link', { name: 'Resume', exact: true }));
    expect(action.y + action.height).toBeLessThanOrEqual(460);
    expect((await bounds(page.locator('.detail-visual'))).height).toBeLessThanOrEqual(150);
    expect(
      await page
        .locator('.description')
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(15);
    expect(
      await page
        .getByRole('heading', { level: 1, name: 'The Tidal Atlas' })
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(28);
  });
  test(`Folio density ${width}: Offline, More and Sync are compact without shrinking action targets`, async ({
    page,
  }) => {
    await open(page, '/offline', width);
    const local = await bounds(page.locator('.offline-row').first());
    expect(local.y).toBeLessThanOrEqual(width === 320 ? 690 : 640);
    expect(local.height).toBeLessThanOrEqual(185);
    await touch(page.getByRole('button', { name: 'Delete local book', exact: true }));
    await page
      .getByRole('navigation', { name: 'Mobile navigation' })
      .getByRole('link', { name: 'More', exact: true })
      .click();
    expect((await bounds(page.locator('.profile-card'))).height).toBeLessThanOrEqual(
      width === 320 ? 190 : 180,
    );
    expect((await bounds(page.locator('.menu-list'))).height).toBeLessThanOrEqual(280);
    await touch(page.getByRole('button', { name: 'Sign out', exact: true }));
    await page.getByRole('link', { name: /Synchronization/ }).click();
    const status = await bounds(page.locator('.status-panel'));
    expect(status.y).toBeLessThanOrEqual(410);
    expect(status.height).toBeLessThanOrEqual(460);
    await touch(page.getByRole('button', { name: 'Simulate delivery failure' }));
  });
  test(`Folio density ${width}: reader chrome frees page area but never resets selected type size`, async ({
    page,
  }) => {
    await open(page, '/read/tidal', width);
    await compactReader(page, width === 320 ? 600 : 615);
  });
}
for (const [width, height, firstY, pageHeight] of [
  [844, 390, 380, 244],
  [1280, 900, 480, 700],
]) {
  test(`Folio density ${width}x${height}: compact rail workspace and featured/query composition`, async ({
    page,
  }) => {
    await open(page, '/library', width, height);
    await compactLibrary(page, firstY);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    expect((await bounds(page.locator('.studio-bar'))).height).toBeLessThanOrEqual(50);
  });
  test(`Folio density ${width}x${height}: compact reader chrome preserves user appearance`, async ({
    page,
  }) => {
    await open(page, '/read/tidal', width, height);
    await compactReader(page, pageHeight);
  });
}
