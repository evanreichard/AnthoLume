import { test, expect, register } from './fixtures';

test('sign-in works without a recovery banner when feature discovery fails', async ({ page, server }) => {
  await register(page, server.origin, 'capabilities-reader');
  await page.context().clearCookies();
  await page.route('**/api/v1/capabilities', route => route.fulfill({ status: 503 }));
  const failed = page.waitForResponse(response => response.url().endsWith('/api/v1/capabilities') && response.status() === 503);
  await page.goto(`${server.origin}/login`);
  await failed;
  await page.getByLabel('Username', { exact: true }).fill('capabilities-reader');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-public-password');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Create an account' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
});

test('a failed signed-in feature check shows a dismissible toast, not session recovery', async ({ page, server }, testInfo) => {
  await register(page, server.origin, 'capability-toast-reader');
  await page.route('**/api/v1/capabilities', route => route.fulfill({ status: 503 }));
  await page.reload();
  const toast = page.locator('[data-snackbar]');
  await expect(toast.getByRole('status')).toContainText('Couldn’t check which features are available');
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('capabilities-toast.png') });
  await toast.getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
});

test('a wrong password shows one form error and lets the reader retry', async ({ page, server }) => {
  await register(page, server.origin, 'auth-error-reader');
  await page.context().clearCookies();
  await page.setViewportSize({ width: 360, height: 480 });
  await page.goto(`${server.origin}/login`);
  await page.getByLabel('Username', { exact: true }).fill('auth-error-reader');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('wrong-password');
  const submit = page.getByRole('button', { name: 'Sign In', exact: true });
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
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/check that you opened the correct app URL/i);
  await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toHaveCount(0);
});
