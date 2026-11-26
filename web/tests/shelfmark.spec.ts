import { DatabaseSync } from 'node:sqlite';
import { expect, register, test } from './fixtures';
import type { ShelfmarkBook, ShelfmarkRelease } from '../src/api/shelfmark';

const dune: ShelfmarkBook = {
  provider: 'hardcover',
  id: 'dune',
  title: 'Dune',
  author: 'Frank Herbert',
  year: 1965,
  description: 'A novel of Arrakis. '.repeat(45).trim(),
  has_cover: true,
  request_count: 0,
};
const paperback: ShelfmarkRelease = {
  key: 'paperback',
  selection: 'opaque-paperback',
  title: 'Dune – Ace Edition',
  author: 'F. Herbert',
  format: 'epub',
  language: 'en',
  size: '1 MB',
  source: 'prowlarr',
  indexer: 'Catalog One',
};
const illustrated: ShelfmarkRelease = {
  ...paperback,
  key: 'illustrated',
  selection: 'opaque-illustrated',
  title: 'Dune – Illustrated',
  format: 'pdf',
  indexer: '',
};
const hardcoverEdition: ShelfmarkRelease = {
  ...paperback,
  key: 'hardcover-edition',
  title: 'Dune – Anniversary Edition',
};
const requested_at = '2026-11-29T12:00:00Z';

test('Settings, explicit release selection and shared request history work across viewport sizes', async ({
  page,
  server,
}) => {
  await register(page, server.origin, 'request-owner');
  const db = new DatabaseSync(`${server.data}/browser.db`);
  try {
    db.prepare('UPDATE users SET admin=1 WHERE id=?').run('request-owner');
  } finally {
    db.close();
  }
  let configured = false;
  let enabled = false;
  let searches = 0;
  let liveLookups = 0;
  let allowLookup!: () => void;
  const firstLookup = new Promise<void>((resolve) => {
    allowLookup = resolve;
  });
  const submissions: string[] = [];
  let allowPost: (() => void) | undefined;
  const saved = [
    { ...paperback, request: { username: 'alex', requested_at, state: 'unconfirmed' as 'unconfirmed' | 'queued' } },
  ];
  await page.route('**/api/v1/shelfmark/settings', (route) => route.fulfill({ json: { configured, enabled } }));
  await page.route('**/api/v1/admin/shelfmark', (route) => {
    expect(route.request().method()).toBe('PUT');
    enabled = route.request().postDataJSON().enabled;
    return route.fulfill({ json: { configured, enabled } });
  });
  await page.route('**/api/v1/shelfmark/search?*', (route) => {
    searches++;
    const q = new URL(route.request().url()).searchParams.get('q');
    return route.fulfill({ json: q === 'herbert' ? [{ ...dune, request_count: saved.length }] : [] });
  });
  await page.route('**/api/v1/shelfmark/cover?*', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW9kAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.route('**/api/v1/shelfmark/releases?*', async (route) => {
    if (++liveLookups === 1) await firstLookup;
    expect(new URL(route.request().url()).searchParams.get('id')).toBe('dune');
    return route.fulfill({ json: { releases: [saved[0], saved[1] ?? illustrated, hardcoverEdition], partial: true } });
  });
  await page.route('**/api/v1/shelfmark/requests?*', (route) =>
    route.fulfill({ json: [{ ...dune, request_count: saved.length }] }),
  );
  await page.route('**/api/v1/shelfmark/requests/releases?*', (route) => route.fulfill({ json: saved }));
  await page.route('**/api/v1/shelfmark/requests', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({
      provider: 'hardcover',
      id: 'dune',
      release_key: illustrated.key,
      selection: illustrated.selection,
    });
    submissions.push(illustrated.key);
    await new Promise<void>((resolve) => {
      allowPost = resolve;
    });
    const row = { ...illustrated, request: { username: 'request-owner', requested_at, state: 'queued' as const } };
    saved.push(row);
    await route.fulfill({ json: { release: row, request_count: saved.length } });
  });
  const tab = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Request', exact: true });
  const toggle = page.getByRole('switch', { name: 'Enable Shelfmark Requests' });
  await page.goto(`${server.origin}/admin/library`);
  await expect(toggle).toBeDisabled();
  await expect(page.getByText('SHELFMARK_API_KEY')).toBeVisible();
  await expect(tab).toHaveCount(0);
  configured = enabled = true;
  await page.reload();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(tab).toHaveCount(0);
  await page.goto(`${server.origin}/request`);
  await expect(page).toHaveURL(`${server.origin}/library`);
  await page.goto(`${server.origin}/admin/library`);
  await toggle.click();
  await tab.click();
  const search = page.getByRole('searchbox');
  const results = page.getByRole('group', { name: 'Search Results' });
  await search.fill('not in catalog');
  await expect(results).toHaveCount(0);
  expect(searches).toBe(0);
  await search.press('Enter');
  await expect(page.getByText(/No books found/)).toBeVisible();
  await search.fill('herbert');
  await expect(results).toHaveCount(0);
  expect(searches).toBe(1);
  await page.getByRole('button', { name: 'Search Books', exact: true }).click();
  const book = results.getByRole('button', { name: 'Dune', exact: true });
  await expect.poll(() => book.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const dialog = page.getByRole('dialog', { name: 'Dune' });
  const now = Date.now();
  for (const width of [320, 390, 1280]) {
    if (width === 390) await page.clock.setFixedTime(now + 10 * 60_000);
    await page.setViewportSize({ width, height: 844 });
    if (width === 1280) {
      await expect(page.getByRole('group', { name: 'Request Views' })).toHaveCount(0);
      const left = await page.getByRole('region', { name: 'Find a Book' }).boundingBox();
      const right = await page.getByRole('region', { name: 'Request History' }).boundingBox();
      expect(right!.x).toBeGreaterThanOrEqual(left!.x + left!.width);
    } else {
      await expect(page.getByRole('button', { name: 'History', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Request History' })).toHaveCount(0);
    }
    await book.click();
    if (width === 320) {
      await expect(dialog.getByText('Finding releases…')).toBeVisible();
      allowLookup();
    }
    await expect(dialog.locator('header').getByText('Frank Herbert · 1965')).toBeVisible();
    const more = dialog.getByRole('button', { name: 'Show More' });
    await more.click();
    await expect(dialog.getByRole('button', { name: 'Show Less' })).toHaveAttribute('aria-expanded', 'true');
    await dialog.getByRole('button', { name: 'Show Less' }).click();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.getByText(paperback.title)).toBeVisible();
    await expect(dialog.getByText('By F. Herbert').first()).toBeVisible();
    await expect(dialog.getByText(/Requested by alex/)).toBeVisible();
    await expect(dialog.getByText(/Some sources didn’t return results/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: `Unconfirmed ${paperback.title}` })).toBeDisabled();
    expect(submissions).toHaveLength(0);
    await dialog.getByRole('button', { name: `Download ${illustrated.title}` }).click({ trial: true });
    expect(await dialog.evaluate((node) => node.scrollWidth)).toBeLessThanOrEqual(width);
    await dialog.getByRole('button', { name: 'Close Dialog' }).click();
    await expect(book).toBeFocused();
  }
  await book.click();
  const download = dialog.getByRole('button', { name: `Download ${illustrated.title}` });
  await expect(download).toBeEnabled();
  expect(liveLookups).toBe(1);
  const searchesBeforeDownload = searches;
  await download.click();
  await expect(dialog.getByRole('button', { name: `Queueing… ${illustrated.title}` })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: `Download ${hardcoverEdition.title}` })).toBeEnabled();
  await expect.poll(() => submissions.length).toBe(1);
  allowPost?.();
  await expect(dialog.getByText(/Requested by request-owner/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: `Queued ${illustrated.title}` })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close Dialog' }).click();
  await expect(book).toHaveAccessibleDescription(/2 requests/);
  expect(searches).toBe(searchesBeforeDownload);
  expect(liveLookups).toBe(1);
  const history = page.getByRole('region', { name: 'Request History' });
  await expect(history.getByRole('button', { name: 'Dune', exact: true })).toHaveCount(1);
  saved[0].request.state = 'queued';
  const beforeHistory = liveLookups;
  await history.getByRole('button', { name: 'Dune', exact: true }).click();
  await expect(dialog.getByText(illustrated.title)).toBeVisible();
  await expect(dialog.getByText(paperback.title)).toBeVisible();
  await expect(dialog.getByRole('button', { name: `Queued ${illustrated.title}` })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: `Queued ${paperback.title}` })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close Dialog' }).click();
  await book.click();
  await expect(dialog.getByRole('button', { name: `Queued ${paperback.title}` })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: `Download ${hardcoverEdition.title}` })).toBeEnabled();
  expect(liveLookups).toBe(beforeHistory);
  await dialog.getByRole('button', { name: 'Close Dialog' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(history).toBeVisible();
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(search).toHaveValue('herbert');
  expect(submissions).toEqual([illustrated.key]);
});

test('A failed release lookup is retryable, and invalid selections never queue automatically', async ({
  page,
  server,
}) => {
  await register(page, server.origin, 'release-reader');
  await page.route('**/api/v1/shelfmark/settings', (route) =>
    route.fulfill({ json: { configured: true, enabled: true } }),
  );
  await page.route('**/api/v1/shelfmark/search?*', (route) => route.fulfill({ json: [{ ...dune, has_cover: false }] }));
  let lookups = 0;
  let queueCalls = 0;
  await page.route('**/api/v1/shelfmark/releases?*', (route) => {
    lookups++;
    return lookups === 1
      ? route.fulfill({
          status: 502,
          contentType: 'application/problem+json',
          json: {
            code: 'shelfmark_upstream_error',
            title: 'Bad Gateway',
            status: 502,
            type: 'urn:antholume:problem:shelfmark_upstream_error',
            detail: 'Shelfmark could not complete the lookup.',
          },
        })
      : route.fulfill({ json: { releases: [lookups === 2 ? paperback : illustrated], partial: false } });
  });
  await page.route('**/api/v1/shelfmark/requests', (route) => {
    queueCalls++;
    return route.fulfill({
      status: 400,
      contentType: 'application/problem+json',
      json: {
        code: 'shelfmark_invalid_selection',
        title: 'Bad Request',
        status: 400,
        type: 'urn:antholume:problem:shelfmark_invalid_selection',
        detail: 'Refresh releases.',
      },
    });
  });
  await page.goto(`${server.origin}/request`);
  const search = page.getByRole('searchbox');
  await search.fill('Dune');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Dune', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toHaveText('Couldn’t load releases from Shelfmark.');
  await expect(dialog.getByRole('alert')).toHaveCSS('text-align', 'center');
  await dialog.getByRole('button', { name: 'Retry Releases' }).click();
  await dialog.getByRole('button', { name: `Download ${paperback.title}` }).click();
  await expect(dialog.getByRole('alert')).toContainText('This release list has changed.');
  await dialog.getByRole('button', { name: `Refresh Releases for ${paperback.title}` }).click();
  await expect(dialog.getByRole('button', { name: `Download ${illustrated.title}` })).toBeEnabled();
  expect(queueCalls).toBe(1);
});
