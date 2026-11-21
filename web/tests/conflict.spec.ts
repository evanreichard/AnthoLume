import { ko } from './ko';
import { test, expect, register } from './fixtures';
import { pendingIds, serverEffects, storedRows } from './storage';

for (const choice of ['This device', 'Server']) {
test(`resume conflict: ${choice} opens without publishing progress`, async ({ page, server }) => {
  const user = `ko-${Date.now()}`;
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  const detail = page.url();
  await page.getByRole('link', { name: 'Read', exact: true }).click();
  await expect(page.locator('footer')).toContainText('1 /');
  await ko(server.origin, user, .95);
  const shared = await ko(server.origin, user);
  await page.keyboard.press('c');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(() => serverEffects(server.data, user).receipts).toMatchObject([{ kind: 'progress', status: 409 }]);
  await expect.poll(async () => (await storedRows(page, 'books')).find(book => book.ref?.documentId === 'book_001')?.checkpoint).toEqual({ position: shared.progress, fraction: .95 });
  expect(await pendingIds(page)).toEqual([]);
  await expect(page.locator('footer')).toContainText('2 /');
  await page.keyboard.press('c');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Resume position changed on another device.' })).toBeVisible();
  const effects = serverEffects(server.data, user);
  await page.setViewportSize({ width: 320, height: 844 });
  const openConflict = async () => {
    await page.goto(detail);
    await page.getByRole('link', { name: 'Resume', exact: true }).click();
    return page.getByRole('dialog', { name: 'Conflicting Positions', exact: true });
  };
  let dialog = await openConflict();
  await expect(dialog.getByRole('button', { name: /^This device · \d+%/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Server · 95%/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  dialog = await openConflict();
  await dialog.getByRole('button', { name: new RegExp(`^${choice} ·`) }).click();
  await expect(page.getByRole('region', { name: 'Book reader', exact: true })).toHaveAttribute('data-reader-state', 'ready');
  if (choice === 'This device') await expect(page.locator('footer')).toContainText('2 /');
  else await expect(page.locator('footer')).not.toContainText(/^2 \//);
  expect(await pendingIds(page)).toEqual([]);
  expect(serverEffects(server.data, user)).toEqual(effects);
  await page.goto(detail);
  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Book reader', exact: true })).toHaveAttribute('data-reader-state', 'ready');
  await expect(page.getByRole('dialog', { name: 'Conflicting Positions' })).toHaveCount(0);
});
}
