import { writeFile, unlink } from 'node:fs/promises';
import type { Request } from '@playwright/test';
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
      await page.getByRole('button', { name: 'Next Page', exact: true }).click();
      await expect(page.locator('footer')).toContainText('2 /');
      await expect.poll(() => serverEffects(server.data, user).receipts.length).toBe(1);
      const ids = await pendingIds(page);
      expect(ids).toHaveLength(1);
      await page.keyboard.press('c');
      await page.getByRole('button', { name: 'Library', exact: true }).click();
      await page.goto(`${server.origin}/settings?sync=open`);
      await expect(page.getByRole('region', { name: 'Sync status' }).getByText('1 pending', { exact: true })).toBeVisible();
      expect(await pendingIds(page)).toEqual(ids);
      const effects = serverEffects(server.data, user);
      await unlink(`${server.data}/receipt-fault`);
      await page.getByRole('button', { name: 'Retry Synchronization' }).click();
      await expect.poll(() => pendingIds(page)).toEqual([]);
      expect(serverEffects(server.data, user)).toEqual(effects);
    } finally { await unlink(`${server.data}/receipt-fault`).catch(() => undefined); }
  });
}

test('a lost activity response after commit retries the identical submission on reopening without double credit', async ({ page, context, server }) => {
  const user = 'lost-activity-response';
  await register(page, server.origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  const started = Date.now();
  await page.clock.setFixedTime(started);
  await page.getByRole('link', { name: 'Read', exact: true }).click();
  await expect(page.locator('footer')).toContainText('1 /');

  const path = '**/api/v1/me/activity';
  const isActivity = (request: Request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/me/activity';
  let committed = false;
  await page.route(path, async route => {
    if (!isActivity(route.request())) return route.continue();
    if (!committed) {
      committed = (await route.fetch()).ok();
      expect(committed).toBe(true);
    }
    await route.abort();
  });
  const lost = page.waitForEvent('requestfailed', isActivity);
  await page.clock.setFixedTime(started + 30_000);
  await page.keyboard.press('c');
  await page.getByRole('button', { name: 'Next Page', exact: true }).click();
  const payload = (await lost).postDataJSON();
  expect(serverEffects(server.data, user)).toMatchObject({ activity: 1, activitySeconds: 30, receipts: expect.arrayContaining([expect.objectContaining({ event_id: payload.event_id, kind: 'activity', status: 200 })]) });
  expect((await storedRows(page, 'events')).find(row => row.id === payload.event_id)?.payload).toEqual(payload);
  await page.close();
  const reopened = await context.newPage();
  const retry = reopened.waitForResponse(response => isActivity(response.request()) && response.status() === 200);
  await reopened.goto(`${server.origin}/library`);
  expect((await retry).request().postDataJSON()).toEqual(payload);
  await expect.poll(() => pendingIds(reopened)).not.toContain(payload.event_id);
  expect((await storedRows(reopened, 'offline')).filter(row => row.kind === 'activity')).toEqual([]);
  const effects = serverEffects(server.data, user);
  expect(effects).toMatchObject({ activity: 1, activitySeconds: 30 });
  expect(effects.receipts.filter(receipt => receipt.kind === 'activity')).toHaveLength(1);
});
