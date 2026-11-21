import { test, expect, register } from './fixtures';

test('tab return and reconnect keep the same rendition until the server confirms sign-out', async ({ page, context, server }) => {
  await register(page, server.origin, 'session-refresh-reader');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
  await expect(page.locator('footer')).toContainText('1 /');
  const readerURL = page.url();
  const originalFrame = await page.locator('iframe').first().elementHandle();
  const sessionURL = '**/api/v1/session';
  const visible = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const sameFrame = () => originalFrame.evaluate(frame => frame.isConnected && frame === document.querySelector('iframe'));

  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(sessionURL, async route => { await held; await route.continue(); }, { times: 1 });
  const response = page.waitForResponse(sessionURL);
  try {
    await Promise.all([page.waitForRequest(sessionURL), visible()]);
    await expect(page.locator('footer')).toContainText('1 /');
    expect(await sameFrame()).toBe(true);
  } finally {
    release();
  }
  await response;
  await expect(page).toHaveURL(readerURL);

  await page.route(sessionURL, route => route.abort(), { times: 1 });
  await visible();
  await expect(page.getByText('Connection unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('footer')).toContainText('1 /');
  expect(await sameFrame()).toBe(true);

  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.getByText('Connection unavailable', { exact: true })).toHaveCount(0);
  expect(await sameFrame()).toBe(true);

  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('iframe')).toHaveCount(0);
});
