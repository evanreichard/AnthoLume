import { readFile, unlink, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, register, signIn } from './fixtures';
import { pendingIds, serverEffects, storedRows } from './storage';

async function prepare(page: Page, origin: string, user: string) {
  await register(page, origin, user);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByText('✓ Available offline', { exact: true })).toBeVisible();
}
async function turn(page: Page) {
  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await expect(page.locator('footer')).toContainText('1 /');
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('footer')).toContainText('2 /');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
}

for (const fault of ['malformed-401', 'valid-401']) {
  test(`actual client/reader ${fault}: only a validated current-lease Problem pauses authentication`, async ({ page, server }) => {
    const user = `event-${fault}-${Date.now()}`;
    await prepare(page, server.origin, user);
    const before = await storedRows(page, 'access');
    await writeFile(`${server.data}/receipt-fault`, fault);
    try {
      await turn(page);
      await expect.poll(() => serverEffects(server.data, user).receipts.length).toBe(1);
      if (fault === 'malformed-401') {
        await expect(page.getByRole('banner').getByRole('link', { name: 'Account', exact: true })).toBeVisible();
        await expect.poll(() => pendingIds(page)).toHaveLength(1);
        await expect.poll(() => storedRows(page, 'access')).toEqual(before);
        await page.getByRole('banner').getByRole('link', { name: /pending/ }).click();
        await expect(page.getByRole('heading', { name: 'retryable-error', exact: true })).toBeVisible();
        expect(await storedRows(page, 'access')).toEqual(before);
      } else {
        await expect(page.getByRole('link', { name: 'Sign in again', exact: true })).toBeVisible();
        expect((await storedRows(page, 'access'))[0].authenticated).toBe(false);
        expect(await pendingIds(page)).toHaveLength(1);
      }
      const effects = serverEffects(server.data, user);
      await unlink(`${server.data}/receipt-fault`);
      if (fault === 'valid-401') await signIn(page, server.origin, user);
      else await page.getByRole('button', { name: 'Retry synchronization', exact: true }).click();
      await expect.poll(() => pendingIds(page)).toEqual([]);
      expect(serverEffects(server.data, user)).toEqual(effects);
      await expect(page.getByRole('banner').getByRole('link', { name: 'Account', exact: true })).toBeVisible();
    } finally { await unlink(`${server.data}/receipt-fault`).catch(() => undefined); }
  });
}

test('late valid event 401 after real two-tab lease takeover cannot expire unchanged current authentication', async ({ page, context, server }) => {
  const user = `lease-401-${Date.now()}`;
  await prepare(page, server.origin, user);
  const other = await context.newPage();
  try {
    await other.goto(`${server.origin}/app/library`);
    await expect(other.getByRole('banner').getByRole('link', { name: 'Account', exact: true })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Add book', exact: true })).toBeEnabled();
    await other.getByRole('banner').getByRole('link', { name: 'Sync', exact: true }).click();
    await expect(other.getByRole('button', { name: 'Retry synchronization', exact: true })).toBeVisible();
    await expect.poll(async () => (await storedRows(other, 'access'))[0]?.authenticated).toBe(true);
    const accessBefore = await storedRows(page, 'access');
    let bootstrapRequests = 0;
    page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/session') bootstrapRequests++; });
    await writeFile(`${server.data}/receipt-fault`, 'held-valid-401');
    await turn(page);
    await expect.poll(async () => readFile(`${server.data}/event-held`, 'utf8').catch(() => '')).not.toBe('');
    const lease = (await storedRows(page, 'leases'))[0];
    expect(lease.until).toBeGreaterThan(Date.now());
    expect(await storedRows(page, 'access')).toEqual(accessBefore);
    await page.evaluate(() => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('antholume-reading-v1');
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('leases', 'readwrite'), store = tx.objectStore('leases');
        const all = store.getAll();
        all.onsuccess = () => { for (const row of all.result) store.put({ ...row, until: 0 }); };
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    }));
    await other.getByRole('button', { name: 'Retry synchronization', exact: true }).click();
    await expect.poll(async () => (await storedRows(other, 'leases'))[0]?.fence).toBeGreaterThan(lease.fence!);
    await expect.poll(() => pendingIds(other)).toEqual([]);
    const replacement = (await storedRows(other, 'leases'))[0];
    expect(replacement.owner).not.toBe(lease.owner);
    expect(replacement.epoch).toBe(lease.epoch);
    expect(await storedRows(page, 'access')).toEqual(accessBefore);
    const delivered = page.waitForResponse((response) => response.url().endsWith('/api/v1/me/reading-progress') && response.status() === 401);
    await writeFile(`${server.data}/release-event`, 'release the old lease response');
    await delivered;
    await expect(page.getByRole('banner').getByRole('link', { name: 'Account', exact: true })).toBeVisible();
    await expect.poll(() => storedRows(page, 'access')).toEqual(accessBefore);
    expect(bootstrapRequests).toBe(0);
    expect(serverEffects(server.data, user).receipts).toHaveLength(1);
    expect(await pendingIds(page)).toEqual([]);
  } finally {
    await other.close();
    for (const name of ['receipt-fault', 'event-held', 'release-event']) await unlink(`${server.data}/${name}`).catch(() => undefined);
  }
});
