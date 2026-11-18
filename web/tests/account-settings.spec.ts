import { expect, register, test } from './fixtures';

test('Settings updates timezone, manages devices and rotates the current password session', async ({ page, server }) => {
  await register(page, server.origin, 'settings-reader');
  const endpoint = `${server.origin}/api/v1`;
  const { csrf_token } = await (await page.request.get(`${endpoint}/session`)).json();
  const registered = await page.request.post(`${endpoint}/me/devices`, {
    headers: { Origin: server.origin, 'X-CSRF-Token': csrf_token },
    data: { id: 'settings-device', name: 'Original reader' },
  });
  expect(registered.status()).toBe(200);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Settings' }).click();
  const modal = page.getByRole('dialog');
  const save = modal.getByRole('button', { name: 'Save changes' });
  await page.getByRole('button', { name: 'Change timezone' }).click();
  await modal.getByLabel('Timezone').fill('Asia/Tokyo');
  await save.click();
  await expect(page.getByText('Timezone updated.')).toBeVisible();
  await page.getByRole('button', { name: 'Manage Original reader' }).click();
  await modal.getByLabel('Custom name').fill('Bedside reader');
  await modal.getByLabel('Archive this device').check();
  await save.click();
  await expect(page.getByRole('button', { name: 'Manage Bedside reader' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show archived devices (1)' }).click();
  await expect(page.getByText('Bedside reader · Archived')).toBeVisible();
  await page.getByRole('button', { name: 'Change password' }).click();
  await modal.getByLabel('Current password').fill('synthetic-public-password');
  await modal.getByLabel('New password', { exact: true }).fill('synthetic-replacement-password');
  await modal.getByLabel('Confirm new password').fill('synthetic-replacement-password');
  await save.click();
  await expect(page.getByText('Password changed. Other sessions were signed out.')).toBeVisible();
  await page.getByRole('button', { name: 'Manage Bedside reader' }).click();
  await modal.getByLabel('Archive this device').uncheck();
  await save.click();
  await expect(modal).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/Asia\/Tokyo · Used for Insights/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage Bedside reader' })).toBeVisible();
});
