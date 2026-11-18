import { writeFile, unlink } from 'node:fs/promises';
import { test, expect, register } from './fixtures';
import { pendingIds, serverEffects, storedRows } from './storage';

for (const fault of ['extra-field', 'server-error']) {
  test(`actual committed HTTP event with ${fault} receipt remains pending until an exact valid retry`, async ({ page, server }) => {
    const user = `receipt-${fault}-${Date.now()}`;
    await register(page, server.origin, user);
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    await writeFile(`${server.data}/receipt-fault`, fault);
    try {
      await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
      await expect(page.locator('footer')).toContainText('1 /');
      await page.keyboard.press('c');
      await page.getByRole('button', { name: 'Next page', exact: true }).click();
      await expect(page.locator('footer')).toContainText('2 /');
      await expect.poll(() => serverEffects(server.data, user).receipts.length).toBe(1);
      const ids = await pendingIds(page);
      expect(ids).toHaveLength(1);
      expect((await storedRows(page, 'decisions')).filter((row) => ids.includes(row.id!))).toEqual([]);
      await page.keyboard.press('c');
      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await page.goto(`${server.origin}/app/settings?sync=open`);
      await expect(page.getByRole('region', { name: 'Sync status' }).getByText('1 pending', { exact: true })).toBeVisible();
      expect(await pendingIds(page)).toEqual(ids);
      const effects = serverEffects(server.data, user);
      await unlink(`${server.data}/receipt-fault`);
      await page.getByRole('button', { name: 'Retry synchronization' }).click();
      await expect.poll(() => pendingIds(page)).toEqual([]);
      expect(serverEffects(server.data, user)).toEqual(effects);
      expect((await storedRows(page, 'decisions')).filter((row) => row.outcome === 'receipt').map((row) => row.receipt?.event_id)).toEqual(ids);
    } finally { await unlink(`${server.data}/receipt-fault`).catch(() => undefined); }
  });
}
