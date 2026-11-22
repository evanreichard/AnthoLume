import { unlink, writeFile } from 'node:fs/promises';
import { test, expect, register } from './fixtures';
import { ko } from './ko';
import { pendingIds, serverEffects, storedRows } from './storage';

for (const fault of ['503', 'malformed-200']) {
  test(`server position wins after a ${fault} state read recovers; activity syncs once`, async ({ page, server }) => {
    const user = `outage-${fault}-${Date.now()}`;
    await register(page, server.origin, user);
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    const started = Date.now();
    await page.clock.setFixedTime(started);
    await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
    await expect(page.locator('footer')).toContainText('1 /');
    const path = '**/api/v1/me/reading-progress';
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(path, async route => { await held; await route.continue(); }, { times: 1 });
    try {
      const attempted = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/me/reading-progress'));
      await page.clock.setFixedTime(started + 30_000);
      await page.keyboard.press('c');
      await page.getByRole('button', { name: 'Next Page', exact: true }).click();
      await expect(page.locator('footer')).toContainText('2 /');
      const submitted = (await attempted).postDataJSON();
      await expect.poll(() => pendingIds(page)).toEqual([submitted.event_id]);
      const previous = serverEffects(server.data, user);
      expect(previous).toMatchObject({ activity: 1, activitySeconds: 30 });

      await page.keyboard.press('c');
      await page.getByRole('button', { name: 'Next Page', exact: true }).click();
      await expect(page.locator('footer')).toContainText('3 /');
      const checkpoint = async () => (await storedRows(page, 'books')).find(book => book.ref?.documentId === 'book_001')?.checkpoint;
      const local = await checkpoint();
      expect(local?.position).toBeTruthy();
      expect(local?.position).not.toBe(submitted.position);
      await ko(server.origin, user, .8);
      await writeFile(`${server.data}/state-fault`, fault);
      const conflicting = page.waitForResponse(response => response.url().endsWith('/me/reading-progress') && response.status() === 409);
      release();
      await conflicting;
      // Keep the second turn in the same reader session while checking conflict recovery for the attempted submission.
      await page.keyboard.press('c');
      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await page.getByRole('link', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: 'Sync', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Waiting to retry', exact: true })).toBeVisible();
      await expect.poll(() => pendingIds(page)).toEqual([submitted.event_id]);
      expect(await checkpoint()).toEqual(local);
      const effects = serverEffects(server.data, user);
      expect(effects).toMatchObject({ activity: previous.activity, activitySeconds: previous.activitySeconds });
      expect(effects.receipts).toEqual(expect.arrayContaining([
        ...previous.receipts,
        expect.objectContaining({ event_id: submitted.event_id, kind: 'progress', status: 409 }),
      ]));
      await unlink(`${server.data}/state-fault`);
      await page.getByRole('button', { name: 'Retry Synchronization', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Resume position changed on another device.' })).toBeVisible();
      await expect.poll(() => pendingIds(page)).toEqual([]);
      const shared = await ko(server.origin, user);
      expect(await checkpoint()).toEqual({ position: shared.progress, fraction: .8 });
      expect(serverEffects(server.data, user)).toEqual(effects);
    } finally {
      release();
      await unlink(`${server.data}/state-fault`).catch(() => undefined);
    }
  });
}
