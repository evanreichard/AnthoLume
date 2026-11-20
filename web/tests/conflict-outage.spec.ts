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
    const [sealed] = await storedRows(page, 'events');
    expect(sealed.kind).toBe('progress');
    await page.clock.setFixedTime(started + 30_000);
    await page.keyboard.press('c');
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.locator('footer')).toContainText('3 /');
    const events = await storedRows(page, 'events');
    const activity = events.filter((event) => event.kind === 'activity');
    expect(events.filter((event) => event.kind === 'progress')).toEqual([sealed]);
    expect(activity).toHaveLength(1);
    expect(activity[0].payload?.duration).toBe(30);
    const latest = (await storedRows(page, 'books')).find((book) => book.ref?.documentId === 'book-001')!.checkpoint!;
    expect(latest.position).toBeTruthy();
    expect(latest.position).not.toBe(sealed.payload?.position);
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
      await page.goto(`${server.origin}/settings?sync=open`);
      await expect(page.getByRole('region', { name: 'Sync status' })).toBeVisible();
      await expect.poll(() => serverEffects(server.data, user).activity).toBe(1);
      const retained = { eventId: sealed.id, local: latest, server: null, currentRevision: '1', refreshError: expect.any(String) };
      await expect.poll(() => storedRows(page, 'conflicts')).toMatchObject([retained]);
      expect(await pendingIds(page)).toEqual([sealed.id]);
      const casIndex = timeline.findIndex((response) => response.path.endsWith('/reading-progress') && response.status === 409);
      const stateIndex = timeline.findIndex((response, index) => index > casIndex && response.path.endsWith('/reading-state/book-001') && response.status === (fault === '503' ? 503 : 200));
      const activityIndex = timeline.findIndex((response) => response.path.endsWith('/activity') && response.status === 200);
      expect(casIndex).toBeGreaterThanOrEqual(0);
      expect(stateIndex).toBeGreaterThan(casIndex);
      expect(activityIndex).toBeGreaterThan(stateIndex);
      await expect(page.getByRole('alert').filter({ hasText: /needs fresh server details/ }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Refresh shared position', exact: true })).toHaveCount(0);
      const effects = serverEffects(server.data, user);
      expect(effects.activitySeconds).toBe(30);
      expect(effects.receipts).toHaveLength(2);
      expect(effects.receipts).toEqual(expect.arrayContaining([
        expect.objectContaining({ event_id: sealed.id, kind: 'progress', status: 409 }),
        expect.objectContaining({ event_id: activity[0].id, kind: 'activity', status: 200 }),
      ]));
      expect(progressPosts).toBe(1);
      expect(activityPosts).toBe(1);
      const retryState = page.waitForResponse((response) => response.url().includes('/me/reading-state/'));
      await page.getByRole('button', { name: 'Retry synchronization', exact: true }).click();
      expect((await retryState).status()).toBe(fault === '503' ? 503 : 200);
      expect(await pendingIds(page)).toEqual([sealed.id]);
      await server.stop();
      await server.start();
      await page.reload();
      await expect(page.getByRole('region', { name: 'Sync status' })).toBeVisible();
      await expect(page.getByRole('alert').filter({ hasText: /needs fresh server details/ }).first()).toBeVisible();
      expect(serverEffects(server.data, user)).toEqual(effects);
      expect(progressPosts).toBe(1);
      expect(activityPosts).toBe(1);
      expect(await pendingIds(page)).toEqual([sealed.id]);
      expect(await storedRows(page, 'conflicts')).toMatchObject([retained]);
      await unlink(`${server.data}/state-fault`);
      await page.getByRole('button', { name: 'Retry synchronization', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Refresh shared position', exact: true })).toHaveCount(1);
      await page.getByRole('button', { name: 'Refresh shared position', exact: true }).click();
      await expect(page.getByText('Shared position: 80%', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Use shared position', exact: true }).click();
      await expect.poll(() => pendingIds(page)).toEqual([]);
      expect((await storedRows(page, 'books')).find((book) => book.ref?.documentId === 'book-001')?.checkpoint?.fraction).toBe(.8);
      expect(serverEffects(server.data, user)).toEqual(effects);
      expect((await ko(server.origin, user)).percentage).toBe(.8);
      expect(progressPosts).toBe(1);
      expect(activityPosts).toBe(1);
    } finally { await unlink(`${server.data}/state-fault`).catch(() => undefined); }
  });
}
