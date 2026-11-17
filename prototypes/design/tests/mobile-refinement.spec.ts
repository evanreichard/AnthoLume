import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sampleParagraphs } from '../src/data';

const textPage = (page: Page) => page.locator('article.page-text');
async function open(page: Page, route: string, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.goto(`/?direction=folio&theme=light#${route}`);
}
async function appearance(page: Page, size: string, font = 'serif') {
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByLabel('Typeface').selectOption(font);
  await page.getByRole('slider', { name: 'Text size' }).fill(size);
  await page.keyboard.press('Escape');
  await expect(textPage(page)).toHaveCSS('font-size', `${size}px`);
}
async function fits(page: Page) {
  await expect
    .poll(() =>
      textPage(page).evaluate((element) => ({
        vertical: element.scrollHeight <= element.clientHeight,
        horizontal: element.scrollWidth <= element.clientWidth,
        document: document.documentElement.scrollHeight <= innerHeight,
        documentWidth: document.documentElement.scrollWidth <= innerWidth,
        scroll: scrollY,
        textScroll: element.scrollTop,
      })),
    )
    .toEqual({
      vertical: true,
      horizontal: true,
      document: true,
      documentWidth: true,
      scroll: 0,
      textScroll: 0,
    });
}
async function containsAnchor(page: Page, anchor: number) {
  await expect(textPage(page)).toHaveAttribute('data-anchor', String(anchor));
  await expect
    .poll(() =>
      textPage(page).evaluate(
        (element, word) =>
          Number(element.dataset.pageStart) <= word && word < Number(element.dataset.pageEnd),
        anchor,
      ),
    )
    .toBe(true);
}

for (const width of [320, 390]) {
  test(`Folio ${width}: unified default, semantic cover sources and one search/filter row`, async ({
    page,
  }) => {
    await open(page, '/library', width);
    await expect(page.locator('.book-card')).toHaveCount(5);
    await expect(
      page.locator('.book-card').getByRole('img', { name: 'Source: Shared library' }),
    ).toHaveCount(4);
    await expect(
      page.locator('.book-card').getByRole('img', { name: 'Source: Local original' }),
    ).toHaveCount(1);
    const local = page.locator('.book-card').filter({ hasText: 'Field Notes' });
    await expect(local).toContainText('Available offline · demo');
    const icon = await local.getByRole('img').boundingBox();
    const cover = await local.locator('.book-cover-area').boundingBox();
    expect(icon!.x).toBeGreaterThanOrEqual(cover!.x);
    expect(icon!.y + icon!.height).toBeLessThanOrEqual(cover!.y + cover!.height);
    await expect(page.getByRole('button', { name: 'Shared library', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Local books', exact: true })).toHaveCount(0);
    const search = await page.getByRole('searchbox').boundingBox();
    const filter = await page
      .getByRole('button', { name: 'Filter library', exact: true })
      .boundingBox();
    expect(Math.abs(search!.y - filter!.y)).toBeLessThan(8);
    expect(filter!.x).toBeGreaterThan(search!.x + search!.width);
    await page.getByRole('searchbox').fill('Alex');
    await expect(page.getByRole('heading', { name: 'Field Notes', exact: true })).toBeVisible();
    await expect(page.locator('.book-card')).toHaveCount(1);
    await expect(page).toHaveURL(/#\/library\?q=Alex/);
  });

  test(`Folio ${width}: filter draft, apply, reset, counts, Escape focus and browser Back`, async ({
    page,
  }) => {
    await open(page, '/library', width);
    const filter = page.getByRole('button', { name: /Filter library/ });
    await filter.click();
    const dialog = page.getByRole('dialog');
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    expect((await dialog.boundingBox())!.width).toBe(width);
    await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'Apply filters · 5 titles' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
    await dialog.getByRole('radio', { name: 'Shared library', exact: true }).check();
    await dialog.getByRole('radio', { name: 'Available offline', exact: true }).check();
    await expect(dialog.getByRole('status')).toContainText('2 matching titles');
    await page.keyboard.press('Escape');
    await expect(filter).toBeFocused();
    await expect(page.locator('.book-card')).toHaveCount(5);
    await filter.click();
    await expect(dialog.getByRole('radio', { name: 'All sources' })).toBeChecked();
    await dialog.getByRole('radio', { name: 'Shared library', exact: true }).check();
    await dialog.getByRole('radio', { name: 'Online only', exact: true }).check();
    await dialog.getByRole('button', { name: 'Apply filters · 2 titles' }).click();
    await expect(page.locator('.book-card')).toHaveCount(2);
    await expect(page).toHaveURL(/source=shared&availability=online/);
    await expect(filter).toBeFocused();
    await filter.click();
    await dialog.getByRole('button', { name: 'Reset filters' }).click();
    await expect(dialog.getByRole('status')).toContainText('5 matching titles');
    await dialog.getByRole('button', { name: 'Apply filters · 5 titles' }).click();
    await expect(page.locator('.book-card')).toHaveCount(5);
    await expect(page).not.toHaveURL(/source=|availability=/);
    await page.goBack();
    await expect(page.locator('.book-card')).toHaveCount(2);
    await expect(page).toHaveURL(/source=shared&availability=online/);
    await page.goBack();
    await expect(page.locator('.book-card')).toHaveCount(5);
    await filter.click();
    await dialog.getByRole('radio', { name: 'Available offline', exact: true }).check();
    await expect(dialog.getByRole('status')).toContainText('3 matching titles');
    await dialog.getByRole('button', { name: 'Apply filters · 3 titles' }).click();
    await expect(page.locator('.book-card')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'Field Notes', exact: true })).toBeVisible();
    await expect(
      page.locator('.book-card').getByRole('img', { name: 'Source: Shared library' }),
    ).toHaveCount(2);
  });
}

test('Folio search + source + availability URL survives detail, reader, Back and reload', async ({
  page,
}) => {
  await open(page, '/library');
  await page.getByRole('searchbox').fill('Mara');
  await page.getByRole('button', { name: 'Filter library', exact: true }).click();
  await page.getByRole('radio', { name: 'Shared library', exact: true }).check();
  await page.getByRole('radio', { name: 'Available offline', exact: true }).check();
  await page.getByRole('button', { name: 'Apply filters · 1 title' }).click();
  const url = page.url();
  await page.getByRole('link', { name: 'The Tidal Atlas', exact: true }).click();
  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('searchbox')).toHaveValue('Mara');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.goBack();
  await expect(page).not.toHaveURL(/source=/);
  await expect(page.getByRole('searchbox')).toHaveValue('Mara');
});

test('Folio logout unified Library exposes only local identities and local-only counts', async ({
  page,
}) => {
  await open(page, '/more');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out · retain downloads' }).click();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'Library' })
    .click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.getByRole('main')).not.toContainText(
    /The Tidal Atlas|Mara Ellery|Ordinary Light|Theo Arden/,
  );
  await page.getByRole('button', { name: 'Filter library', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Shared library', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('1 matching title');
  await page.getByRole('radio', { name: 'Online only', exact: true }).check();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('0 matching titles');
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await page.getByRole('button', { name: 'Apply filters · 1 title' }).click();
  await page.getByRole('link', { name: 'Field Notes', exact: true }).click();
  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await fits(page);
  await expect(page.getByRole('link', { name: 'Demo · account events paused →' })).toBeVisible();
  await expect(page.getByRole('link', { name: /2 pending/ })).toHaveCount(0);
});

for (const [width, height] of [
  [320, 568],
  [320, 844],
  [390, 844],
  [844, 390],
  [568, 320],
  [1280, 900],
]) {
  test(`Folio ${width}x${height}: real pages contain every sample word exactly once, no vertical scroll at 28px`, async ({
    page,
  }) => {
    await open(page, '/read/tidal', width, height);
    await fits(page);
    await appearance(page, '28');
    await fits(page);
    const collected: string[] = [];
    let previousEnd = 0;
    let turns = 0;
    const totalWords = sampleParagraphs.join(' ').split(/\s+/).length;
    while (turns++ < 80) {
      await fits(page);
      const range = await textPage(page).evaluate((element) => ({
        start: Number(element.dataset.pageStart),
        end: Number(element.dataset.pageEnd),
      }));
      expect(range.start).toBe(previousEnd);
      expect(range.end).toBeGreaterThan(range.start);
      collected.push((await textPage(page).innerText()).trim().replace(/\s+/g, ' '));
      previousEnd = range.end;
      if (range.end === totalWords) break;
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(textPage(page)).toBeFocused();
    }
    expect(turns).toBeGreaterThan(1);
    expect(collected.join(' ')).toBe(sampleParagraphs.join(' '));
    await page.mouse.wheel(0, 800);
    await page.keyboard.press('PageDown');
    await fits(page);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'A map of small things' }),
    ).toBeFocused();
    await expect(textPage(page)).toHaveAttribute('data-anchor', '0');
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'The harbour at first light' }),
    ).toBeFocused();
    await expect(textPage(page)).toHaveAttribute('data-page-end', String(totalWords));
    await fits(page);
  });
}

for (const width of [320, 390]) {
  test(`Folio ${width}: font, size, quiet chrome and orientation repaginate around the logical anchor`, async ({
    page,
  }) => {
    await open(page, '/read/tidal', width);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    const anchor = Number(await textPage(page).getAttribute('data-anchor'));
    expect(anchor).toBeGreaterThan(0);
    const beforeEnd = await textPage(page).getAttribute('data-page-end');
    await appearance(page, '28', 'sans');
    await containsAnchor(page, anchor);
    await expect(textPage(page)).not.toHaveAttribute('data-page-end', beforeEnd!);
    await fits(page);
    await page.setViewportSize({ width: width === 320 ? 568 : 844, height: width });
    await containsAnchor(page, anchor);
    await fits(page);
    await page.getByRole('button', { name: 'Quiet reading', exact: true }).click();
    await containsAnchor(page, anchor);
    await fits(page);
    await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Show reading controls' }).click();
    await containsAnchor(page, anchor);
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toBeFocused();
    await page.setViewportSize({ width, height: 844 });
    await containsAnchor(page, anchor);
    await fits(page);
  });
}

test('Folio bounded horizontal swipe turns a page; vertical movement does not', async ({
  page,
}) => {
  await open(page, '/read/tidal');
  const box = await textPage(page).boundingBox();
  await textPage(page).dispatchEvent('pointerdown', {
    isPrimary: true,
    clientX: 280,
    clientY: box!.y + 50,
  });
  await textPage(page).dispatchEvent('pointerup', {
    isPrimary: true,
    clientX: 100,
    clientY: box!.y + 55,
  });
  await expect(textPage(page)).not.toHaveAttribute('data-anchor', '0');
  const anchor = await textPage(page).getAttribute('data-anchor');
  await textPage(page).dispatchEvent('pointerdown', {
    isPrimary: true,
    clientX: 200,
    clientY: box!.y + 50,
  });
  await textPage(page).dispatchEvent('pointerup', {
    isPrimary: true,
    clientX: 190,
    clientY: box!.y + 250,
  });
  await expect(textPage(page)).toHaveAttribute('data-anchor', anchor!);
  await fits(page);
});

test('Folio landscape filter sheet scroll is contained and Apply remains reachable', async ({
  page,
}) => {
  await open(page, '/library', 844, 390);
  await page.getByRole('button', { name: 'Filter library', exact: true }).click();
  await page.getByRole('radio', { name: 'Local originals', exact: true }).check();
  await page.getByRole('radio', { name: 'Available offline', exact: true }).check();
  await page.getByRole('button', { name: 'Apply filters · 1 title' }).click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Field Notes', exact: true })).toBeVisible();
});

test('Folio focused mobile and pagination review captures', async ({ page }) => {
  const directory = resolve(
    process.env.M2_SCREENSHOT_DIR || '../../_scratch/m2/design/screenshots',
  );
  await mkdir(directory, { recursive: true });
  for (const width of [320, 390]) {
    await open(page, '/library', width);
    await page.reload();
    await page.screenshot({ path: `${directory}/folio-refined-${width}-library.png` });
    await page.getByRole('button', { name: 'Filter library', exact: true }).click();
    await page.getByRole('radio', { name: 'Local originals', exact: true }).check();
    await page.getByRole('radio', { name: 'Available offline', exact: true }).check();
    await page.screenshot({ path: `${directory}/folio-refined-${width}-filters.png` });
    await page.getByRole('button', { name: 'Apply filters · 1 title' }).click();
    await page.screenshot({ path: `${directory}/folio-refined-${width}-local-offline.png` });
    await open(page, '/read/tidal', width);
    await page.reload();
    await appearance(page, '28');
    await fits(page);
    await page.screenshot({ path: `${directory}/folio-refined-${width}-reader28.png` });
    await page.setViewportSize({ width: width === 320 ? 568 : 844, height: width });
    await fits(page);
    await page.screenshot({ path: `${directory}/folio-refined-${width}-landscape28.png` });
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.screenshot({ path: `${directory}/folio-refined-${width}-landscape-panel.png` });
    await page.keyboard.press('Escape');
  }
  await open(page, '/read/tidal', 1280, 900);
  await fits(page);
  await page.screenshot({ path: `${directory}/folio-refined-desktop-reader.png` });
});
