import type { ShelfmarkBook, ShelfmarkRelease, ShelfmarkReleases } from '../src/api/shelfmark';
import { test, expect, register } from './fixtures';

const book: ShelfmarkBook = {
  provider: 'hardcover',
  id: '69589',
  title: 'The Time Machine',
  author: 'H. G. Wells',
  description: '',
  year: 1895,
  has_cover: false,
  request_count: 0,
};
const best: ShelfmarkRelease = {
  key: 'best',
  source: 'indexer',
  title: 'H. G. Wells - The Time Machine [EPUB]',
  format: 'epub',
  size: '',
  language: 'en',
  indexer: '',
  selection: 'best-selection',
};
const other: ShelfmarkRelease = { ...best, key: 'other', title: 'Other listing', selection: 'other-selection' };
const scenarios = [
  { basis: 'title_author', reason: 'Title and author match', width: 320 },
  { basis: 'isbn', reason: 'ISBN match', width: 390 },
  { basis: undefined, reason: undefined, width: 1280 },
] as const;

for (const { basis, reason, width } of scenarios) {
  test.describe(`${width}px`, () => {
    test.use({ hasTouch: basis === 'isbn' });
    test(`Request releases show ${basis ?? 'no'} recommendation`, async ({ page, server }) => {
      await page.setViewportSize({ width, height: 844 });
      const result: ShelfmarkReleases = {
        releases: basis ? [best, other] : [other, best],
        partial: false,
        recommendation: basis ? { release_key: best.key, basis } : undefined,
      };
      const saved: ShelfmarkRelease = {
        ...best,
        selection: undefined,
        request: { username: 'alex', requested_at: '2026-01-02T12:00:00Z', state: 'queued' },
      };
      const submissions: unknown[] = [];
      await page.route('**/api/v1/shelfmark/settings', (route) =>
        route.fulfill({ json: { enabled: true, configured: true } }),
      );
      await page.route('**/api/v1/shelfmark/search?*', (route) => route.fulfill({ json: [book] }));
      await page.route('**/api/v1/shelfmark/releases?*', (route) => route.fulfill({ json: result }));
      await page.route('**/api/v1/shelfmark/requests**', (route) => {
        const request = route.request();
        if (request.method() === 'POST') {
          submissions.push(request.postDataJSON());
          return route.fulfill({ json: { release: saved, request_count: 1 } });
        }
        const history = new URL(request.url()).pathname.endsWith('/releases');
        return route.fulfill({ json: submissions.length ? (history ? [saved] : [{ ...book, request_count: 1 }]) : [] });
      });
      await register(page, server.origin, `request-${width}`);
      await page.getByRole('link', { name: 'Request', exact: true }).click();
      await page.getByRole('searchbox', { name: 'Search Books to Request' }).fill(book.title);
      await page.getByRole('button', { name: 'Search Books', exact: true }).click();
      await page
        .getByRole('group', { name: 'Search Results' })
        .getByRole('button', { name: /The Time Machine/ })
        .click();

      const dialog = page.getByRole('dialog', { name: book.title });
      const rows = dialog.getByRole('region', { name: 'Ebook Releases' }).getByRole('listitem');
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toContainText(basis ? best.title : other.title);
      const badge = dialog.getByRole('button', { name: 'Recommended', exact: true });
      const tooltip = dialog.getByRole('tooltip');
      await expect(badge).toHaveCount(basis ? 1 : 0);
      await expect(tooltip).toBeHidden();
      if (reason) {
        await expect(rows.first().getByRole('button', { name: 'Recommended', exact: true })).toBeVisible();
        await expect(badge).toHaveAccessibleDescription(reason);
        if (basis === 'isbn') {
          await badge.tap();
        } else {
          await badge.hover();
          await expect(tooltip).toHaveText(reason);
          await tooltip.hover();
          await expect(tooltip).toBeVisible();
          await dialog.getByRole('heading', { name: book.title }).hover();
          await expect(tooltip).toBeHidden();
          await dialog.getByRole('button', { name: 'Close Dialog' }).focus();
          await page.keyboard.press('Tab');
          await expect(badge).toBeFocused();
          await expect(tooltip).toHaveText(reason);
          await page.keyboard.press('Escape');
          await expect(tooltip).toBeHidden();
          await expect(dialog).toBeVisible();
          await expect(badge).toBeFocused();
          await page.keyboard.press('Enter');
        }
        await expect(tooltip).toHaveText(reason);
        const { y } = (await dialog.boundingBox())!;
        if (basis === 'isbn') await page.touchscreen.tap(width / 2, y / 2);
        else await page.mouse.click(width / 2, y / 2);
        await expect(tooltip).toBeHidden();
        await expect(dialog).toBeVisible();
        expect(submissions).toEqual([]);
      }
      await expect(dialog.getByRole('button', { name: `Download ${other.title}`, exact: true })).toBeEnabled();
      const download = dialog.getByRole('button', { name: `Download ${best.title}`, exact: true });
      await download.click({ trial: true });
      expect(submissions).toEqual([]);
      await download.click();
      await expect(dialog.getByRole('button', { name: `Queued ${best.title}`, exact: true })).toBeDisabled();
      expect(submissions).toEqual([
        { provider: book.provider, id: book.id, release_key: best.key, selection: best.selection },
      ]);
      await dialog.getByRole('button', { name: 'Close Dialog' }).click();
      if (width < 900) await page.getByRole('button', { name: 'History', exact: true }).click();
      await page
        .getByRole('region', { name: 'Request History' })
        .getByRole('button', { name: /The Time Machine/ })
        .click();
      const history = dialog.getByRole('region', { name: 'Requested Releases' });
      await expect(history.getByRole('listitem')).toContainText(best.title);
      await expect(history.getByText('Recommended', { exact: true })).toHaveCount(0);
    });
  });
}
