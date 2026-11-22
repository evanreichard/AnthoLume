import { test, expect, register } from './fixtures';

test('a wrong password shows one form error and lets the reader retry', async ({ page, server }) => {
  await register(page, server.origin, 'auth-error-reader');
  await page.context().clearCookies();
  await page.setViewportSize({ width: 360, height: 480 });
  await page.goto(`${server.origin}/login`);
  await page.getByLabel('Username', { exact: true }).fill('auth-error-reader');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('wrong-password');
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  await submit.click();

  await expect(page.getByRole('alert')).toHaveText('The username or password is incorrect.');
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
  await expect(page.locator('img[src="/assets/icons/mark.svg"]')).toBeInViewport({ ratio: 1 });
  await expect(submit).toBeInViewport({ ratio: 1 });
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue('auth-error-reader');
  await password.fill('synthetic-public-password');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
});

test('rejected sessions suggest checking the app URL instead of reconnecting', async ({ page, server }) => {
  await page.goto(`${server.origin}/login`);
  await page.route('**/api/v1/session/login', async route => {
    const headers = await route.request().allHeaders();
    delete headers['x-csrf-token'];
    await route.continue({ headers });
  }, { times: 1 });
  await page.getByLabel('Username', { exact: true }).fill('auth-error-reader');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-public-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/check that you opened the correct app URL/i);
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
});
