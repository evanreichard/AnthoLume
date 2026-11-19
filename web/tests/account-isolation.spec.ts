import { DatabaseSync } from 'node:sqlite';
import { test, expect, register, signIn } from './fixtures';
import { pendingIds, serverEffects, storedRows } from './storage';

test('a recreated username cannot reopen the previous account URL, reuse its cache, or send its pending events', async ({ page, context, browser, server }) => {
  const username = 'reused-reader';
  const endpoint = `${server.origin}/api/v1`;
  const admin = await browser.newPage();
  try {
    await register(admin, server.origin, 'isolation-admin');
    const db = new DatabaseSync(`${server.data}/browser.db`);
    try { db.prepare('UPDATE users SET admin=1 WHERE id=?').run('isolation-admin'); }
    finally { db.close(); }
    await register(page, server.origin, username);
    const original = (await (await page.request.get(`${endpoint}/session`)).json()).user;
    const progress = '**/api/v1/me/reading-progress';
    await page.route(progress, route => route.abort());
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
    await expect(page.locator('footer')).toContainText('1 /');
    const originalScope = JSON.stringify(['account', server.origin, original.account_id, original.reading_generation]);
    await expect.poll(async () => (await storedRows(page, 'books')).some(row => row.ref?.documentId === 'book-001' && row.scope === originalScope)).toBe(true);
    const originalReader = page.url();
    expect(new URL(originalReader).searchParams.get('account')).toBe(original.account_id);
    await page.keyboard.press('c');
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.locator('footer')).toContainText('2 /');
    await expect.poll(() => pendingIds(page)).toHaveLength(1);
    const originalPending = await pendingIds(page);
    await context.clearCookies();
    await page.goto(`${server.origin}/login`);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await page.unroute(progress);

    const { user, csrf_token } = await (await admin.request.get(`${endpoint}/session`)).json();
    const headers = { Origin: server.origin, 'X-CSRF-Token': csrf_token, 'X-AnthoLume-Account': user.account_id };
    const deletion = await admin.request.delete(`${endpoint}/admin/users/${username}`, { headers });
    expect(deletion.status(), await deletion.text()).toBe(204);
    const creation = await admin.request.post(`${endpoint}/admin/users`, { headers, data: { username, password: 'synthetic-public-password', is_admin: false } });
    expect(creation.status(), await creation.text()).toBe(201);

    const submitted: string[] = [];
    page.on('request', request => {
      if (/\/api\/v1\/me\/(reading-progress|activity)$/.test(request.url())) submitted.push(request.url());
    });
    await signIn(page, server.origin, username);
    const replacement = (await (await page.request.get(`${endpoint}/session`)).json()).user;
    expect(replacement.id).toBe(original.id);
    expect(replacement.account_id).not.toBe(original.account_id);
    const stale = await page.request.get(`${endpoint}/documents/book-001/file`, { headers: { 'X-AnthoLume-Account': original.account_id } });
    expect(stale.status()).toBe(401);
    await page.goto(originalReader);
    await expect(page.getByRole('heading', { name: 'Book not available for this account' })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('link', { name: /pending/ })).toHaveCount(0);
    await page.getByRole('link', { name: 'Return to Library' }).click();
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    const file = page.waitForRequest(request => request.url().endsWith('/api/v1/documents/book-001/file'));
    await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
    const fileHeaders = await (await file).allHeaders();
    expect(fileHeaders['if-none-match']).toBeUndefined();
    expect(fileHeaders['x-antholume-account']).toBe(replacement.account_id);
    await expect(page.locator('footer')).toContainText('1 /');
    expect(await pendingIds(page)).toEqual(originalPending);
    expect((await storedRows(page, 'events')).find(row => row.id === originalPending[0])?.scope).toBe(originalScope);
    expect(serverEffects(server.data, username).receipts).toEqual([]);
    expect(submitted).toEqual([]);
  } finally {
    await admin.close();
  }
});
