import { ko } from './ko';
import { test, expect, register } from './fixtures';
import { pendingIds, serverEffects, storedRows } from './storage';

test('a newer KOReader position wins without jumping the open web reader', async ({ page, server }) => {
  const user = `ko-${Date.now()}`;
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('link', { name: 'Read', exact: true }).click();
  await expect(page.locator('footer')).toContainText('1 /');
  await ko(server.origin, user, .95);
  const shared = await ko(server.origin, user);
  await page.keyboard.press('c');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(() => serverEffects(server.data, user).receipts).toMatchObject([{ kind: 'progress', status: 409 }]);
  await expect.poll(async () => (await storedRows(page, 'books')).find(book => book.ref?.documentId === 'book-001')?.checkpoint).toEqual({ position: shared.progress, fraction: .95 });
  expect(await pendingIds(page)).toEqual([]);
  await expect(page.locator('footer')).toContainText('2 /');
  await page.keyboard.press('c');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Resume position changed on another device.' })).toBeVisible();
  expect((await ko(server.origin, user)).percentage).toBe(.95);
});
