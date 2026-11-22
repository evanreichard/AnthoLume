import { test, expect, register } from './fixtures';

test('a failed session refresh keeps the same rendition while the backend is reachable, until sign-out is confirmed', async ({ page, context, server }) => {
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
  const recovery = page.getByRole('region', { name: 'App update and recovery' });
  await expect(recovery.getByText('Connection unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Offline Profiles', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(readerURL);
  await expect(page.locator('footer')).toContainText('1 /');
  expect(await sameFrame()).toBe(true);

  await recovery.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(recovery).toHaveCount(0);
  expect(await sameFrame()).toBe(true);

  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('a stopped backend preserves a live reader but a cold tab asks who is reading', async ({ page, context, server }) => {
  const user = 'session-backend-offline';
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
  await expect(page.locator('footer')).toContainText('1 /');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  const readerURL = page.url();
  const originalFrame = await page.locator('iframe').first().elementHandle();
  const sameFrame = () => originalFrame.evaluate(frame => frame.isConnected && frame === document.querySelector('iframe'));
  const recovery = page.getByRole('region', { name: 'App update and recovery' });

  await server.stop();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await expect(recovery.getByText('Connection unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Offline Profiles', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(readerURL);
  await expect(page.locator('footer')).toContainText('1 /');
  expect(await sameFrame()).toBe(true);

  const cold = await context.newPage();
  try {
    await cold.goto(`${server.origin}/library`);
    await expect(cold.getByRole('heading', { name: 'Offline Profiles', exact: true })).toBeVisible();
    await expect(cold.getByRole('button', { name: user, exact: true })).toBeVisible();
  } finally { await cold.close(); }

  await server.start();
  await recovery.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(recovery).toHaveCount(0);
  await expect(page).toHaveURL(readerURL);
  await expect(page.locator('footer')).toContainText('1 /');
  expect(await sameFrame()).toBe(true);
});
