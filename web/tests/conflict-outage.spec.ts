import { unlink, writeFile } from 'node:fs/promises';
import { test, expect, register } from './fixtures';
import { ko } from './ko';
import { pendingIds, serverEffects, storedRows } from './storage';

for (const fault of ['503', 'malformed-200']) {
  test(`real CAS conflict followed by state-only ${fault} retains progress while the independent 30-second activity credits once`, async ({ page, context, server }) => {
    const user = `outage-${fault}-${Date.now()}`;
    await register(page, server.origin, user);
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    const started = Date.now();
    await page.clock.setFixedTime(started);
    await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
    await expect(page.locator('footer')).toContainText('1 /');
    await context.setOffline(true);
    await page.keyboard.press('c');
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.locator('footer')).toContainText('2 /');
    await expect.poll(async () => (await storedRows(page, 'events')).length).toBe(1);
    await page.clock.setFixedTime(started + 30_000);
    await page.keyboard.press('c');
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.locator('footer')).toContainText('3 /');
    await expect.poll(async () => (await storedRows(page, 'events')).length).toBe(3);
    const events = await storedRows(page, 'events');
    const progress = events.filter((event) => event.kind === 'progress').map((event) => event.id!);
    const activity = events.filter((event) => event.kind === 'activity');
    expect(progress).toHaveLength(2);
    expect(activity).toHaveLength(1);
    expect(activity[0].payload?.duration).toBe(30);
    await page.keyboard.press('c');
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await writeFile(`${server.data}/state-fault`, fault);
    try {
      await ko(server.origin, user, .8);
      const timeline: { path: string; status: number }[] = [];
      let progressPosts = 0, activityPosts = 0;
      page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'POST' && path.endsWith('/me/reading-progress')) progressPosts++;
        if (request.method() === 'POST' && path.endsWith('/me/activity')) activityPosts++;
      });
      page.on('response', (response) => {
        const path = new URL(response.url()).pathname;
        if (path.startsWith('/api/v1/me/')) timeline.push({ path, status: response.status() });
      });
      await context.setOffline(false);
      await page.goto(`${server.origin}/app/settings?sync=open`);
      await expect(page.getByRole('region', { name: 'Sync status' })).toBeVisible();
      await expect.poll(() => serverEffects(server.data, user).activity).toBe(1);
      await expect.poll(async () => (await storedRows(page, 'conflicts')).length).toBe(2);
      const conflicts = await storedRows(page, 'conflicts');
      expect(conflicts.every((conflict) => conflict.server === null && conflict.currentRevision === '1' && !!conflict.refreshError)).toBe(true);
      expect((await pendingIds(page)).sort()).toEqual([...progress].sort());
      const casIndex = timeline.findIndex((response) => response.path.endsWith('/reading-progress') && response.status === 409);
      const activityIndex = timeline.findIndex((response) => response.path.endsWith('/activity') && response.status === 200);
      expect(casIndex).toBeGreaterThanOrEqual(0);
      expect(activityIndex).toBeGreaterThan(casIndex);
      expect(timeline.some((response) => response.path.includes('/reading-state/') && response.status === (fault === '503' ? 503 : 200))).toBe(true);
      await expect(page.getByRole('alert').filter({ hasText: /needs fresh server details/ }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Refresh shared position', exact: true })).toHaveCount(0);
      const effects = serverEffects(server.data, user);
      expect(effects.activitySeconds).toBe(30);
      expect(effects.receipts.filter((receipt) => receipt.kind === 'progress' && receipt.status === 409)).toHaveLength(2);
      expect(effects.receipts.filter((receipt) => receipt.kind === 'activity' && receipt.status === 200)).toHaveLength(1);
      expect(progressPosts).toBe(2);
      expect(activityPosts).toBe(1);
      await page.getByRole('button', { name: 'Retry synchronization', exact: true }).click();
      await expect.poll(async () => (await pendingIds(page)).length).toBe(2);
      await server.stop();
      await server.start();
      await page.reload();
      await expect(page.getByRole('region', { name: 'Sync status' })).toBeVisible();
      await expect(page.getByRole('alert').filter({ hasText: /needs fresh server details/ }).first()).toBeVisible();
      expect(serverEffects(server.data, user)).toEqual(effects);
      expect(progressPosts).toBe(2);
      expect(activityPosts).toBe(1);
      expect((await pendingIds(page)).sort()).toEqual([...progress].sort());
      await unlink(`${server.data}/state-fault`);
      await page.getByRole('button', { name: 'Retry synchronization', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Refresh shared position', exact: true })).toHaveCount(2);
      for (let remaining = 2; remaining > 0; remaining--) {
        const card = page.getByRole('article').first();
        await card.getByRole('button', { name: 'Refresh shared position', exact: true }).click();
        await expect(card).toContainText('Shared position: 80%');
        await card.getByRole('button', { name: 'Use shared position', exact: true }).click();
        await expect.poll(async () => (await pendingIds(page)).length).toBe(remaining - 1);
      }
      expect(serverEffects(server.data, user)).toEqual(effects);
      expect((await ko(server.origin, user)).percentage).toBe(.8);
      expect(progressPosts).toBe(2);
      expect(activityPosts).toBe(1);
    } finally { await unlink(`${server.data}/state-fault`).catch(() => undefined); }
  });
}
