import { DatabaseSync } from 'node:sqlite';
import { expect, register, test } from './fixtures';

test('Shelfmark preview gates navigation and lets a reader review a request before confirming', async ({
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
  const tab = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Request', exact: true });
  const toggle = page.getByRole('switch', { name: 'Enable Shelfmark Requests' });
  await page.goto(`${server.origin}/admin/library`);
  await expect(toggle).toBeDisabled();
  await expect(page.getByText('SHELFMARK_API_KEY')).toBeVisible();
  await expect(tab).toHaveCount(0);
  await page.goto(`${server.origin}/admin/library?shelfmarkPreview=configured`);
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
      await expect(page.getByRole('dialog').getByText(/Requested by request-owner on/)).toBeVisible();
      await page.getByRole('button', { name: 'Done' }).click();
    }
    await expect(dune).toHaveAccessibleDescription(/Requested/);
    await page.getByRole('button', { name: 'History', exact: true }).click();
    const history = page.getByRole('region', { name: 'Request History' });
    await expect(history.getByRole('button').first()).toHaveAccessibleName('Dune');
    await expect(history.getByRole('button').first()).toHaveAccessibleDescription(/Requested by request-owner/);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(search).toHaveValue('herbert');
    await page.reload();
  }
});
