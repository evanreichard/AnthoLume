import { unlink, writeFile } from 'node:fs/promises';
import { test, expect, register } from './fixtures';
import { ko } from './ko';
import { pendingIds, serverEffects, storedRows } from './storage';

for (const fault of ['503', 'malformed-200']) {
  test(`server position wins after a ${fault} state read recovers; activity syncs once`, async ({ page, context, server }) => {
    const user = `outage-${fault}-${Date.now()}`;
    await register(page, server.origin, user);
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    const started = Date.now();
    await page.clock.setFixedTime(started);
    await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
    await expect(page.locator('footer')).toContainText('1 /');
    await context.setOffline(true);
    for (const next of [2, 3]) {
      await page.clock.setFixedTime(started + (next - 2) * 30_000);
      await page.keyboard.press('c');
      await page.getByRole('button', { name: 'Next page', exact: true }).click();
      await expect(page.locator('footer')).toContainText(`${next} /`);
    }
    await expect.poll(() => pendingIds(page)).toHaveLength(2);
    const events = await storedRows(page, 'events');
    const progress = events.find(event => event.kind === 'progress')!;
    const activity = events.find(event => event.kind === 'activity')!;
    const checkpoint = async () => (await storedRows(page, 'books')).find(book => book.ref?.documentId === 'book-001')?.checkpoint;
    const local = await checkpoint();
    expect(local?.position).not.toBe(progress.payload?.position);
    await ko(server.origin, user, .8);
    await writeFile(`${server.data}/state-fault`, fault);
    try {
      await context.setOffline(false);
      await page.goto(`${server.origin}/settings?sync=open`);
      await expect(page.getByRole('heading', { name: 'Waiting to retry', exact: true })).toBeVisible();
      await expect.poll(() => pendingIds(page)).toEqual([progress.id]);
      expect(await checkpoint()).toEqual(local);
      const effects = serverEffects(server.data, user);
      expect(effects.activity).toBe(1);
      expect(effects.activitySeconds).toBe(30);
      expect(effects.receipts).toEqual(expect.arrayContaining([
        expect.objectContaining({ event_id: progress.id, status: 409 }),
        expect.objectContaining({ event_id: activity.id, status: 200 }),
      ]));
      await unlink(`${server.data}/state-fault`);
      await page.getByRole('button', { name: 'Retry synchronization', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Resume position changed on another device.' })).toBeVisible();
      await expect.poll(() => pendingIds(page)).toEqual([]);
      const shared = await ko(server.origin, user);
      expect(await checkpoint()).toEqual({ position: shared.progress, fraction: .8 });
      expect(serverEffects(server.data, user)).toEqual(effects);
    } finally { await unlink(`${server.data}/state-fault`).catch(() => undefined); }
  });
}
