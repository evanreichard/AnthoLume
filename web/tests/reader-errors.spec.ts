import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, register } from './fixtures';
import { storedRows } from './storage';

const reader = (page: Page) => page.getByRole('region', { name: 'Book reader' });
const retry = (page: Page) => reader(page).getByRole('button', { name: 'Try Again', exact: true });
const beginning = (page: Page) => reader(page).getByRole('button', { name: 'Open Beginning Without Changing Saved Position' });
const original = (page: Page) => reader(page).getByRole('button', { name: 'Retry Original Position' });

async function readerURL(page: Page, origin: string) {
  const { user } = await (await page.request.get(`${origin}/api/v1/session`)).json();
  return `${origin}/read/server?${new URLSearchParams({ id: 'book_001', origin, account: user.account_id })}`;
}

async function coldProfile(page: Page, origin: string, user: string) {
  await page.goto(origin);
  await page.getByRole('button', { name: user, exact: true }).click();
  await expect(page.getByRole('region', { name: 'Offline controls' })).toBeVisible();
}

test('a missing offline copy stays blocked until reconnect; Back to Library works offline', async ({ page, context, server }) => {
  const user = 'reader-no-offline-copy';
  await register(page, server.origin, user);
  const url = await readerURL(page, server.origin);
  await page.getByRole('heading', { name: 'Public book 02', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.close();

  const cold = await context.newPage();
  const sessionURL = '**/api/v1/session';
  let reachable = false;
  await cold.route(sessionURL, route => reachable ? route.continue() : route.fulfill({ status: 503 }));
  await coldProfile(cold, server.origin, user);
  await cold.goto(url);

  const noCopy = reader(cold).getByRole('heading', { name: 'No Offline Copy', exact: true });
  await expect(noCopy).toBeVisible();
  await expect(reader(cold).getByRole('alert')).toContainText('This book isn’t saved on this device. Reconnect to open it.');
  await expect(original(cold)).toHaveCount(0);
  await expect(beginning(cold)).toHaveCount(0);
  const back = reader(cold).getByRole('button', { name: 'Back to Library' });
  for (const width of [320, 1280, 390]) {
    await cold.setViewportSize({ width, height: 844 });
    await back.click({ trial: true });
    await retry(cold).click({ trial: true });
  }
  const failedProbe = cold.waitForResponse(response => response.url().endsWith('/api/v1/session') && response.status() === 503);
  await retry(cold).click();
  await failedProbe;
  await expect(reader(cold).getByRole('alert')).toContainText('Still offline.');
  await expect(noCopy).toBeVisible();
  await expect(retry(cold)).toBeEnabled();
  await back.click();
  await expect(cold).toHaveURL(`${server.origin}/library`);
  await expect(cold.getByRole('region', { name: 'Offline controls' })).toBeVisible();

  await cold.goto(url);
  await expect(noCopy).toBeVisible();
  reachable = true;
  const file = cold.waitForResponse(response => response.url().endsWith('/book_001/file') && response.ok());
  await retry(cold).click();
  await file;
  await expect(reader(cold)).toHaveAttribute('data-reader-state', 'ready');
  await expect(noCopy).toHaveCount(0);
});

test('a corrupt offline copy is a general open failure, not a missing copy or position failure', async ({ page, context, server }) => {
  const user = 'reader-corrupt-offline-copy';
  await register(page, server.origin, user);
  const url = await readerURL(page, server.origin);
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('antholume-reading-v1');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('sources', 'readwrite');
      const cursor = tx.objectStore('sources').openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (row) { row.update({ ...row.value, manifestHash: 'corrupt-index' }); row.continue(); }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  await page.close();

  const cold = await context.newPage();
  await cold.route('**/api/v1/session', route => route.fulfill({ status: 503 }));
  await coldProfile(cold, server.origin, user);
  await cold.goto(url);
  await expect(reader(cold).getByRole('heading', { name: 'Couldn’t Open This Book', exact: true })).toBeVisible();
  await expect(reader(cold).getByRole('alert')).toContainText('Validated index integrity mismatch');
  await expect(retry(cold)).toBeVisible();
  await expect(original(cold)).toHaveCount(0);
  await expect(beginning(cold)).toHaveCount(0);
});

test('only a failed saved position offers opening at the beginning without changing progress', async ({ page, server }) => {
  const user = 'reader-invalid-saved-position';
  await register(page, server.origin, user);
  const position = '/body/DocFragment[999]/body';
  const write = await page.request.put(`${server.origin}/api/ko/syncs/progress`, {
    headers: { 'x-auth-user': user, 'x-auth-key': createHash('md5').update('synthetic-public-password').digest('hex') },
    data: { document: 'book_001', percentage: .3, progress: position, device: 'KO reader' },
  });
  expect(write.ok()).toBe(true);
  const stateURL = `${server.origin}/api/v1/me/reading-state/book_001`;
  const remoteState = async () => (await page.request.get(stateURL)).json();
  const initial = await remoteState();
  expect(initial.position).toBe(position);
  await page.goto(await readerURL(page, server.origin));
  await expect(reader(page).getByRole('alert')).toContainText('Saved location unavailable; original retained');
  const reopened = page.waitForResponse(response => response.url() === stateURL && response.ok());
  await original(page).click();
  await reopened;
  await expect(beginning(page)).toBeVisible();
  await beginning(page).click();
  await expect(reader(page)).toHaveAttribute('data-reader-state', 'ready');
  await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Public chapter' })).toBeVisible();
  expect(await remoteState()).toMatchObject({ position, revision: initial.revision });
  expect((await storedRows(page, 'positions')).find(row => row.ref?.documentId === 'book_001')?.checkpoint?.position).toBe(position);
  expect(await storedRows(page, 'events')).toHaveLength(0);
});
