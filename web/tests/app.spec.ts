import { test, expect, register } from './fixtures';

test('actual bootstrap, credentials, server paging, inert detail, URL sorting and compact native controls', async ({ page, server }) => {
  await register(page, server.origin, `layout-${Date.now()}`);
  await expect(page.getByRole('heading', { name: 'Public book 24', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Public book 25', exact: true })).toHaveCount(0);
  let appendRequests = 0;
  await page.route('**/api/v1/documents?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('page') === '2' && query.get('resumable') !== 'true' && ++appendRequests === 1) {
      await route.fulfill({ status: 500, contentType: 'application/problem+json', json: { type: 'about:blank', title: 'Internal Server Error', status: 500, code: 'storage_error' } });
    } else await route.continue();
  });
  const loadMore = page.getByRole('button', { name: 'Load More Shared Books' });
  await loadMore.scrollIntoViewIfNeeded();
  const retry = page.getByRole('button', { name: 'Retry Loading Shared Books' });
  await expect(retry).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Public book 24', exact: true })).toBeAttached();
  await retry.scrollIntoViewIfNeeded();
  expect(appendRequests).toBe(1);
  await retry.click();
  await expect(page.getByRole('heading', { name: 'Public book 30', exact: true })).toBeAttached();
  expect(appendRequests).toBe(2);
  await expect(page.getByRole('article').filter({ has: page.getByRole('heading', { name: /^Public book \d+$/ }) })).toHaveCount(30);
  await expect(loadMore).toHaveCount(0);
  const sort = page.getByRole('button', { name: 'Sort Books' });
  await sort.click();
  await page.getByRole('button', { name: 'Author A–Z', exact: true }).click();
  await expect(page).toHaveURL(/sort=author/);
  await expect(sort).toBeFocused();
  await page.reload();
  await sort.click();
  await expect(page.getByRole('button', { name: 'Author A–Z', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(sort).toBeFocused();
  await page.goto(`${server.origin}/library?q=Public+book+01`);
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Read', exact: true })).toBeVisible();
  await expect(page.getByText('<script>window.__untrusted = true</script>', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => '__untrusted' in window)).toBe(false);
  await page.getByRole('main').getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/q=Public\+book\+01/);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(3);
  await expect(page.getByRole('link', { name: 'Insights', exact: true })).toHaveAttribute('href', '/insights');
});
