import { writeFile, unlink } from 'node:fs/promises';
import { test, expect, register } from './fixtures';
import { pendingIds, serverEffects, storedRows } from './storage';

for (const fault of ['extra-field', 'server-error']) {
  test(`actual committed HTTP event with ${fault} receipt remains pending until an exact valid retry`, async ({ page, server }) => {
    const user = `receipt-${fault}-${Date.now()}`;
    await register(page, server.origin, user);
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(page.getByText('✓ Available offline', { exact: true })).toBeVisible();
    await writeFile(`${server.data}/receipt-fault`, fault);
    try {
      await page.getByRole('link', { name: 'Resume', exact: true }).click();
      await expect(page.locator('footer')).toContainText('1 /');
      await page.getByRole('button', { name: 'Next page', exact: true }).click();
      await expect(page.locator('footer')).toContainText('2 /');
      await expect.poll(() => serverEffects(server.data, user).receipts.length).toBe(1);
      const ids = await pendingIds(page);
      expect(ids).toHaveLength(1);
      expect((await storedRows(page, 'decisions')).filter((row) => ids.includes(row.id!))).toEqual([]);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.goto(`${server.origin}/app/sync`);
      await expect(page.getByText('1 pending events.', { exact: false })).toBeVisible();
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
