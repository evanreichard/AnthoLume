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
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Settings' }).click();
  const account = page.getByRole('region', { name: 'General', exact: true });
  await expect(page.getByRole('main').getByRole('region').first()).toHaveAccessibleName('General');
  await expect(account.getByText('settings-reader', { exact: true })).toBeVisible();
  const sync = account.getByRole('button', { name: 'Sync', exact: true });
  const timezone = account.getByRole('button', { name: 'Locale', exact: true });
  const password = account.getByRole('button', { name: 'Password', exact: true });
  await expect(account.getByRole('button', { name: 'Sign Out', exact: true })).toHaveCount(0);
  const signOut = page.getByRole('main').getByRole('button', { name: 'Sign Out', exact: true });
  await expect(sync).toHaveAttribute('aria-expanded', 'false');
  await expect(account.getByRole('region', { name: 'Sync status' })).toBeHidden();
  const rowWidth = (await sync.boundingBox())!.width;
  for (const control of [sync, timezone, password, signOut]) {
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    if (control !== signOut) expect(box.width).toBe(rowWidth);
  }
  await expect(signOut).toHaveText('Sign Out');
  const debug = page.getByRole('region', { name: 'Debug' });
  const readerCache = debug.getByRole('button', { name: 'Reader Cache', exact: true });
  await readerCache.click();
  const cacheDialog = page.getByRole('dialog', { name: 'Reader Cache', exact: true });
  await expect(cacheDialog.locator('dd')).toHaveText(['0 (0 B)', '0 B']);
  const confirmation = page.getByRole('dialog', { name: 'Clear Reader Cache?', exact: true });
  await expect(confirmation).toHaveCount(0);
  await cacheDialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(confirmation.getByText(/including pinned offline copies/)).toBeVisible();
  await expect(confirmation.getByText(/reading progress, and settings are kept/)).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(cacheDialog.locator('dt')).toHaveText(['Books', 'Metadata']);
  await cacheDialog.getByRole('button', { name: 'Clear', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(cacheDialog.getByRole('status')).toHaveText('Reader cache cleared.');
  await cacheDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(cacheDialog).toHaveCount(0);
  const devices = page.getByRole('region', { name: 'Devices' });
  const originalDevice = devices.getByRole('button', { name: 'Manage Original reader' });
  await expect(originalDevice).toBeVisible();
  await expect(devices.getByRole('navigation', { name: 'Device pages' })).toHaveCount(0);
  expect((await originalDevice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await sync.click();
  await expect(account.getByRole('region', { name: 'Sync status' }).getByText('0 pending')).toBeVisible();
  await expect(page).toHaveURL(`${server.origin}/settings?sync=open`);
  await sync.click();
  await expect(account.getByRole('region', { name: 'Sync status' })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(devices.getByRole('button', { name: 'Manage Original reader' })).toBeVisible();
  const modal = page.getByRole('dialog');
  const save = modal.getByRole('button', { name: 'Save Changes' });
  const toast = page.locator('[data-snackbar]');
  async function expectConfirmation(message: string) {
    await expect(modal).toHaveCount(0);
    await expect(toast.getByRole('status')).toHaveText(message);
    await toast.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(toast).toHaveCount(0);
  }
  await timezone.click();
  await expect(modal).toHaveAccessibleName('Change Locale');
  await expect(modal.getByRole('searchbox')).toHaveCount(0);
  const picker = modal.getByRole('combobox', { name: 'Time zone' });
  await expect(picker.getByRole('option', { name: 'Tokyo · Asia' })).toHaveCount(1);
  await expect(picker.getByRole('option', { name: 'New York · America' })).toHaveCount(1);
  await picker.selectOption({ label: 'Tokyo · Asia' });
  await save.click();
  await expectConfirmation('Timezone updated.');
  await expect(timezone).toHaveAccessibleDescription('Tokyo');
  await page.getByRole('button', { name: 'Manage Original reader' }).getByText('Original reader', { exact: true }).click();
  await expect(modal).toHaveAccessibleName('Manage Device');
  await expect(modal.getByText(/Last synced/)).toBeVisible();
  await modal.getByLabel('Name', { exact: true }).fill('Bedside reader');
  const archive = modal.getByRole('button', { name: 'Archive', exact: true });
  await archive.click();
  await expect(modal).toHaveAccessibleName('Archive Device?');
  await expect(modal.getByText(/unsaved name change/)).toBeVisible();
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(modal).toHaveAccessibleName('Manage Device');
  await expect(modal.getByLabel('Name', { exact: true })).toHaveValue('Bedside reader');
  await modal.getByRole('button', { name: 'Save', exact: true }).click();
  await expectConfirmation('Device settings updated.');
  const bedside = devices.getByRole('button', { name: 'Manage Bedside reader' });
  await expect(bedside).not.toContainText('Archived');
  await bedside.click();
  await archive.click();
  await expect(modal).toHaveAccessibleName('Archive Device?');
  await expect(bedside).not.toContainText('Archived');
  await archive.click();
  await expectConfirmation('Device archived.');
  await expect(bedside).toContainText('Archived');
  await password.click();
  await modal.getByLabel('Current password').fill('synthetic-public-password');
  await modal.getByLabel('New password', { exact: true }).fill('synthetic-replacement-password');
  await modal.getByLabel('Confirm new password').fill('different-password');
  await save.click();
  await expect(modal.getByRole('alert')).toHaveText('New passwords do not match.');
  await expect(toast).toHaveCount(0);
  await modal.getByLabel('Confirm new password').fill('synthetic-replacement-password');
  await save.click();
  await expectConfirmation('Password changed. Other sessions were signed out.');
  await page.getByRole('button', { name: 'Manage Bedside reader' }).click();
  const unarchive = modal.getByRole('button', { name: 'Unarchive', exact: true });
  await unarchive.click();
  await expect(modal).toHaveAccessibleName('Unarchive Device?');
  await unarchive.click();
  await expectConfirmation('Device unarchived.');
  await expect(bedside).toContainText('Synced');
  await page.reload();
  await expect(timezone).toHaveAccessibleDescription('Tokyo');
  await timezone.click();
  await expect(picker).toHaveValue('Asia/Tokyo');
  await expect(picker.locator('option:checked')).toHaveText('Tokyo · Asia');
  await modal.getByRole('button', { name: 'Cancel' }).click();
  await expect(devices.getByRole('button', { name: 'Manage Bedside reader' })).toContainText('Synced');
});

test('account dialogs block all dismissal paths during a save and can retry after failure', async ({ page, server }) => {
  await register(page, server.origin, 'settings-pending-reader');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server.origin}/settings`);

  for (const [name, endpoint, status, code, message] of [
    ['Locale', 'preferences', 400, 'invalid_timezone', 'Choose a time zone supported by this server.'],
    ['Password', 'password', 403, 'incorrect_password', 'Current password is incorrect.'],
  ] as const) {
    const trigger = page.getByRole('button', { name, exact: true });
    const dialog = page.getByRole('dialog', { name: `Change ${name}`, exact: true });
    const close = dialog.getByRole('button', { name: 'Close Dialog' });
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    const save = dialog.getByRole('button', { name: 'Save Changes', exact: true });
    const url = `**/api/v1/me/${endpoint}`;
    let release!: () => void;
    const response = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    await page.route(url, async route => {
      if (++requests !== 1) return route.continue();
      await response;
      await route.fulfill({ status, contentType: 'application/problem+json', json: { type: 'about:blank', title: message, status, code, detail: message } });
    });

    await trigger.click();
    await expect(dialog.getByRole('heading')).toBeFocused();
    try {
      if (name === 'Locale') await dialog.getByRole('combobox', { name: 'Time zone' }).selectOption('Asia/Tokyo');
      else {
        await dialog.getByLabel('Current password').fill('synthetic-public-password');
        await dialog.getByLabel('New password', { exact: true }).fill('synthetic-replacement-password');
        await dialog.getByLabel('Confirm new password').fill('synthetic-replacement-password');
      }
      await save.press('Enter');
      await expect.poll(() => requests).toBe(1);
      await expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled();
      await expect(close).toBeDisabled();
      await expect(cancel).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await page.mouse.click(1, 1);
      await expect(dialog).toBeVisible();
      const x = (await close.boundingBox())!;
      await page.mouse.click(x.x + x.width / 2, x.y + x.height / 2);
      await expect(dialog).toBeVisible();
      expect(requests).toBe(1);
    } finally { release(); }

    await expect(dialog.getByRole('alert')).toHaveText(message);
    await expect(close).toBeEnabled();
    await expect(cancel).toBeEnabled();
    await save.click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(requests).toBe(2);
    await page.unroute(url);
  }

  const locale = page.getByRole('button', { name: 'Locale', exact: true });
  await expect(locale).toHaveAccessibleDescription('Tokyo');
  for (const dismiss of [
    () => page.keyboard.press('Escape'),
    () => page.mouse.click(1, 1),
    () => page.getByRole('button', { name: 'Close Dialog' }).click(),
  ]) {
    await locale.click();
    await dismiss();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(locale).toBeFocused();
  }
});

test('Devices lists ten per page without an expander', async ({ page, server }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page, server.origin, 'device-pager');
  const endpoint = `${server.origin}/api/v1`;
  const { csrf_token } = await (await page.request.get(`${endpoint}/session`)).json();
  for (let i = 0; i < 12; i++) {
    const result = await page.request.post(`${endpoint}/me/devices`, {
      headers: { Origin: server.origin, 'X-CSRF-Token': csrf_token },
      data: { id: `pager-device-${i}`, name: `Reader ${i + 1}` },
    });
    expect(result.status()).toBe(200);
  }
  await page.goto(`${server.origin}/settings`);
  const devices = page.getByRole('region', { name: 'Devices' });
  const rows = devices.getByRole('listitem');
  const pager = devices.getByRole('navigation', { name: 'Device pages' });
  const previous = pager.getByRole('button', { name: 'Previous' });
  const next = pager.getByRole('button', { name: 'Next' });
  await expect(rows).toHaveCount(10);
  await expect(previous).toBeDisabled();
  const first = await rows.allTextContents();
  await next.click();
  await expect(rows).toHaveCount(2);
  await expect(pager.getByRole('status')).toHaveText('2 of 2');
  await expect(next).toBeDisabled();
  await expect(next).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(pager.getByRole('status')).toHaveText('2 of 2');
  expect((await rows.allTextContents()).every(row => !first.includes(row))).toBe(true);
  await devices.screenshot({ path: testInfo.outputPath('devices-last-page.png'), animations: 'disabled' });
  await previous.click();
  await expect(rows).toHaveCount(10);
  expect(await rows.allTextContents()).toEqual(first);
});
