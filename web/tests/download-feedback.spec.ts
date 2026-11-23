import type { Page } from '@playwright/test';
import { expect, register, test } from './fixtures';

const file = '**/api/v1/documents/book_001/file';
const notice = (page: Page) => page.locator('[data-snackbar]');
const failure = 'Couldn’t save for offline reading.';
const toolbar = (page: Page) => page.getByRole('group', { name: 'Book actions' });
const bookHeading = (page: Page, title = 'Public book 01') => page.getByRole('heading', { name: title, exact: true });
const card = (page: Page) => page.getByRole('article').filter({ has: bookHeading(page) });
const libraryLink = (page: Page) => page.getByRole('main').getByRole('link', { name: 'Library', exact: true });
const saved = (page: Page) => card(page).getByRole('img', { name: 'Saved to device' });

async function saveFromLibrary(page: Page) {
  await card(page).getByLabel('Options for Public book 01').click();
  await card(page).getByRole('button', { name: 'Save to Device', exact: true }).click();
}

for (const surface of ['library', 'detail'] as const) {
  test(`a ${surface} save retries the original book and leaves the Save control available`, async ({ page, server }) => {
    await register(page, server.origin, `download-feedback-${surface}`);
    const save = surface === 'library' ? () => saveFromLibrary(page)
      : () => toolbar(page).getByRole('button', { name: 'Save', exact: true }).click();
    if (surface === 'detail') await bookHeading(page).click();
    let failed = true;
    await page.route(file, route => failed ? route.fulfill({ status: 404 }) : route.continue());

    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await save();
      await expect(notice(page).getByRole('status')).toHaveText(failure);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByText('Could not load EPUB from the server', { exact: false })).toHaveCount(0);
      const retry = notice(page).getByRole('button', { name: 'Retry', exact: true });
      const dismiss = notice(page).getByRole('button', { name: 'Dismiss', exact: true });
      await retry.click({ trial: true });
      const box = (await notice(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      if (width < 760) {
        const navigation = (await page.getByRole('navigation', { name: 'Main navigation' }).boundingBox())!;
        expect(box.y + box.height).toBeLessThan(navigation.y);
      }
      if (width !== 1280) {
        await dismiss.click();
        await expect(notice(page)).toHaveCount(0);
      } else {
        failed = false;
        const response = page.waitForResponse(result => result.url().endsWith('/book_001/file') && result.ok());
        await retry.click();
        await response;
      }
    }

    await expect(notice(page).getByRole('status')).toHaveText('Saved to device');
    await expect(notice(page).getByRole('button', { name: 'Retry' })).toHaveCount(0);
    if (surface === 'library') await expect(saved(page)).toBeVisible();
    else await expect(toolbar(page).getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  });
}

test('leaving a book invalidates its Retry and aborts an in-flight save', async ({ page, server }) => {
  await register(page, server.origin, 'download-feedback-route');
  await bookHeading(page).click();
  const save = () => toolbar(page).getByRole('button', { name: 'Save', exact: true }).click();
  await page.route(file, route => route.fulfill({ status: 404 }), { times: 1 });
  await save();
  await expect(notice(page).getByRole('status')).toHaveText(failure);
  await libraryLink(page).click();
  await bookHeading(page, 'Public book 02').click();
  await expect(toolbar(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect(notice(page)).toHaveCount(0);

  await libraryLink(page).click();
  await bookHeading(page).click();
  await page.route(file, () => {});
  await Promise.all([page.waitForRequest(file), save()]);
  const aborted = page.waitForEvent('requestfailed', request => request.url().endsWith('/book_001/file'));
  await libraryLink(page).click();
  await aborted;
  await bookHeading(page, 'Public book 02').click();
  await expect(toolbar(page).getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  await libraryLink(page).click();
  await expect(saved(page)).toHaveCount(0);
});

test('saving the same book in another tab invalidates a pending Retry', async ({ page, context, server }) => {
  await register(page, server.origin, 'download-feedback-tabs');
  const other = await context.newPage();
  try {
    await other.goto(`${server.origin}/library`);
    await other.bringToFront();
    await page.route(file, route => route.fulfill({ status: 404 }));
    await saveFromLibrary(page);
    await expect(notice(page).getByRole('status')).toHaveText(failure);
    await saveFromLibrary(other);
    await expect(saved(other)).toBeVisible();
    await expect(saved(page)).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
  } finally { await other.close(); }
});
