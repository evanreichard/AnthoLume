import { DatabaseSync } from 'node:sqlite';
import { test, expect, register, signIn } from './fixtures';
import { pendingIds, serverEffects } from './storage';

test('restore signs out another browser and preserves its old queue without replaying it', async ({
  page,
  browser,
  server,
}) => {
  const admin = await browser.newPage();
  const endpoint = `${server.origin}/api/v1`;
  const username = 'restore-reader';
  try {
    await register(admin, server.origin, 'restore-admin');
    const db = new DatabaseSync(`${server.data}/browser.db`);
    try {
      db.prepare('UPDATE users SET admin=1 WHERE id=?').run('restore-admin');
    } finally {
      db.close();
    }
    await register(page, server.origin, username);
    const { user: old } = await (await page.request.get(`${endpoint}/session`)).json();
    const { csrf_token } = await (await admin.request.get(`${endpoint}/session`)).json();
    const headers = { Origin: server.origin, 'X-CSRF-Token': csrf_token };
    const downloaded = await admin.request.get(`${endpoint}/admin/backup`);
    expect(downloaded.status()).toBe(200);
    const backup = await downloaded.body();

    const progress = '**/api/v1/me/reading-progress';
    await page.route(progress, (route) => route.abort());
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
    await expect(page.locator('footer')).toContainText('1 /');
    await page.keyboard.press('c');
    await page.getByRole('button', { name: 'Next Page', exact: true }).click();
    await expect(page.locator('footer')).toContainText('2 /');
    await expect.poll(() => pendingIds(page)).toHaveLength(1);
    const queued = await pendingIds(page);

    const staged = await admin.request.post(`${endpoint}/admin/restore`, {
      headers: { ...headers, 'Content-Type': 'application/octet-stream' },
      data: backup,
    });
    expect(staged.status(), await staged.text()).toBe(200);
    const { token } = await staged.json();
    const applied = await admin.request.patch(`${endpoint}/admin/restore`, { headers, data: { token } });
    expect(applied.status(), await applied.text()).toBe(204);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page).toHaveURL(/\/login$/);
    await page.unroute(progress);
    const delivered: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/me/reading-progress')) delivered.push(request.url());
    });
    await signIn(page, server.origin, username);
    const { user: fresh } = await (await page.request.get(`${endpoint}/session`)).json();
    expect(fresh.account_id).toBe(old.account_id);
    expect(fresh.reading_generation).not.toBe(old.reading_generation);
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
    await expect(page.locator('footer')).toContainText('1 /');
    expect(await pendingIds(page)).toEqual(queued);
    expect(serverEffects(server.data, username).receipts).toEqual([]);
    expect(delivered).toEqual([]);
  } finally {
    await admin.close();
  }
});
