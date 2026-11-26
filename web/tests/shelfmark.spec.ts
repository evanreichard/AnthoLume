import { DatabaseSync } from 'node:sqlite';
import { expect, register, test } from './fixtures';
import type { ShelfmarkBook, ShelfmarkRequestInfo } from '../src/api/shelfmark';

test('Shelfmark settings gate navigation, and shared history prevents duplicate requests', async ({ page, server }) => {
  await register(page, server.origin, 'request-owner');
  const db = new DatabaseSync(`${server.data}/browser.db`);
  try {
    db.prepare('UPDATE users SET admin=1 WHERE id=?').run('request-owner');
  } finally {
    db.close();
  }
  let configured = false;
  let enabled = false;
  let submissions = 0;
  const requested_at = '2026-11-29T12:00:00Z';
  const dune: ShelfmarkBook = {
    provider: 'hardcover',
    id: 'dune',
    title: 'Dune',
    author: 'Frank Herbert',
    year: 1965,
    description: 'A novel of Arrakis.',
    has_cover: true,
  };
  const messiah: ShelfmarkBook = {
    ...dune,
    id: 'messiah',
    title: 'Dune Messiah',
    year: 1969,
    has_cover: false,
    request: { username: 'alex', requested_at, state: 'requested' },
  };
  let requested: ShelfmarkRequestInfo | undefined;
  const latest = () => ({ ...dune, ...(requested && { request: requested }) });
  await page.route('**/api/v1/shelfmark/settings', (route) => route.fulfill({ json: { configured, enabled } }));
  await page.route('**/api/v1/admin/shelfmark', (route) => {
    expect(route.request().method()).toBe('PUT');
    enabled = route.request().postDataJSON().enabled;
    return route.fulfill({ json: { configured, enabled } });
  });
  await page.route('**/api/v1/shelfmark/search?*', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    return route.fulfill({ json: q === 'herbert' ? [latest(), messiah] : [] });
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
  await page.route('**/api/v1/shelfmark/requests?*', (route) =>
    route.fulfill({ json: requested ? [latest(), messiah] : [messiah] }),
  );
  await page.route('**/api/v1/shelfmark/requests', (route) => {
    expect(route.request().method()).toBe('POST');
    if (route.request().postDataJSON().check_only) {
      expect(requested?.state).toBe('confirming');
      requested = { username: 'request-owner', requested_at, state: 'requested' };
      return route.fulfill({ json: latest() });
    }
    expect(route.request().postDataJSON()).toEqual({ provider: 'hardcover', id: 'dune' });
    submissions++;
    requested = { username: 'request-owner', requested_at, state: 'confirming' };
    return route.fulfill({ json: latest() });
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
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await tab.click();
    const card = page.getByRole('region', { name: 'Find a Book' });
    const results = card.getByRole('group', { name: 'Search Results' });
    const search = card.getByRole('searchbox');
    await search.fill('not in catalog');
    await expect(results).toHaveCount(0);
    await search.press('Enter');
    await expect(page.getByText(/No books found/)).toBeVisible();
    await search.fill('herbert');
    await expect(results).toHaveCount(0);
    await page.getByRole('button', { name: 'Search Books', exact: true }).click();
    const messiah = results.getByRole('button', { name: 'Dune Messiah', exact: true });
    await expect(messiah).toHaveAccessibleDescription(/Requested by alex/);
    await messiah.click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Request Ebook' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Done' }).click();
    const dune = results.getByRole('button', { name: 'Dune', exact: true });
    await expect
      .poll(() => dune.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await dune.click();
    await page.getByRole('button', { name: 'Close Dialog' }).click();
    await expect(dune).toBeFocused();
    await dune.click();
    if (width === 320) await page.getByRole('button', { name: 'Request Ebook' }).click();
    else {
      await expect(page.getByRole('dialog').getByText(/Shelfmark hasn’t confirmed/)).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('button', { name: 'Request Ebook' })).toHaveCount(0);
      if (width === 1280) await page.getByRole('button', { name: 'Check Status' }).click();
      else await page.getByRole('button', { name: 'Close Dialog' }).click();
    }
    await expect(dune).toHaveAccessibleDescription(
      width === 1280 ? /Requested by request-owner/ : /Confirming Request/,
    );
    await page.getByRole('button', { name: 'History', exact: true }).click();
    const history = page.getByRole('region', { name: 'Request History' });
    await expect(history.getByRole('button').first()).toHaveAccessibleName('Dune');
    await expect(history.getByRole('button').first()).toHaveAccessibleDescription(/Requested by request-owner/);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(search).toHaveValue('herbert');
    await page.reload();
  }
  expect(submissions).toBe(1);
});
