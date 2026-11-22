import { writeFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { test, expect, register } from './fixtures';

const artwork = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGNQqpoDRAwQCgAgRgThJ/yiRwAAAABJRU5ErkJggg==', 'base64');
const documentID = 'book_001';
const fileRoute = `**/api/v1/documents/${documentID}/file`;
const coverRoute = `**/api/v1/documents/${documentID}/cover`;
const bookCard = (page: Page) => page.getByRole('article').filter({ has: page.locator(`a[href*="?id=${documentID}&"]`) });

async function saveBook(page: Page) {
  const card = bookCard(page);
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Save to Device' }).click();
  await expect(card.getByRole('img', { name: 'Saved to device' })).toBeVisible();
}

async function expectArtwork(card: Locator) {
  const cover = card.locator('img[src^="blob:"]');
  await expect(cover).toBeVisible();
  await expect.poll(() => cover.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([2, 2]);
  const pixels = await cover.evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(0, 0, 2, 2).data);
  });
  expect(pixels).toEqual(Array.from({ length: 4 }, () => [0x22, 0x7a, 0x9c, 0xff]).flat());
}

async function storedCovers(page: Page): Promise<{ pinned: boolean; bytes: number[] }[]> {
  return page.evaluate(id => new Promise<{ pinned: boolean; bytes: number[] }[]>((resolve, reject) => {
    const request = indexedDB.open('antholume-reading-v1');
    request.onupgradeneeded = () => { request.transaction?.abort(); reject(new Error('Production reader DB missing')); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('books', 'readonly');
      const rows = tx.objectStore('books').getAll();
      tx.oncomplete = () => {
        db.close();
        resolve(Promise.all(rows.result.filter(row => row.ref.documentId === id && row.cover instanceof Blob).map(async row => ({
          pinned: !!row.pinned,
          bytes: Array.from(new Uint8Array(await row.cover.arrayBuffer())),
        }))));
      };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }), documentID);
}

test('Save to Device keeps the server artwork on a cold offline start and removes it with the download', async ({ page, context, server }) => {
  const user = 'saved-cover-reader';
  await writeFile(`${server.data}/covers/public.png`, artwork);
  await register(page, server.origin, user);
  await saveBook(page);
  await expect.poll(() => storedCovers(page)).toEqual([{ pinned: true, bytes: [...artwork] }]);
  await page.close();
  await context.setOffline(true);

  const cold = await context.newPage();
  await cold.goto(server.origin);
  await cold.getByRole('button', { name: user, exact: true }).click();
  const card = bookCard(cold);
  await expectArtwork(card);
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Remove from Device' }).click();
  await cold.getByRole('dialog', { name: 'Remove this download?' }).getByRole('button', { name: 'Remove from Device' }).click();
  await expect(card).toHaveCount(0);

  expect(await storedCovers(cold)).toEqual([]);
});

test('opening a book directly caches artwork without pinning the book', async ({ page, context, server }) => {
  const user = 'read-cover-reader';
  await writeFile(`${server.data}/covers/public.png`, artwork);
  await register(page, server.origin, user);
  const { user: identity } = await (await page.request.get(`${server.origin}/api/v1/session`)).json();
  const params = new URLSearchParams({ id: documentID, account: identity.account_id, origin: server.origin });
  await page.goto(`${server.origin}/read/server?${params}`);
  await expect(page.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
  await expect.poll(() => storedCovers(page)).toEqual([{ pinned: false, bytes: [...artwork] }]);
  await page.close();
  await context.setOffline(true);

  const cold = await context.newPage();
  await cold.goto(server.origin);
  await cold.getByRole('button', { name: user, exact: true }).click();
  const card = bookCard(cold);
  await expectArtwork(card);
  await expect(card.getByRole('img', { name: 'Saved to device' })).toHaveCount(0);
});

test('a missing cover does not block saving and backfills online without downloading the EPUB again', async ({ page, context, server }) => {
  const user = 'backfill-cover-reader';
  await writeFile(`${server.data}/covers/public.png`, artwork);
  await context.route(coverRoute, route => route.fulfill({ status: 404 }));
  await register(page, server.origin, user);
  await saveBook(page);
  await page.close();

  await context.setOffline(true);
  const cold = await context.newPage();
  await cold.goto(server.origin);
  await cold.getByRole('button', { name: user, exact: true }).click();
  await expect(bookCard(cold).getByRole('img', { name: 'Saved to device' })).toBeVisible();
  await expect(bookCard(cold).locator('img[src^="blob:"]')).toHaveCount(0);
  await cold.close();

  let fileRequests = 0;
  await context.route(fileRoute, route => { fileRequests++; return route.abort(); });
  await context.unroute(coverRoute);
  await context.setOffline(false);
  const online = await context.newPage();
  await online.goto(`${server.origin}/library`);
  await expectArtwork(bookCard(online));
  await expect.poll(() => storedCovers(online)).toEqual([{ pinned: true, bytes: [...artwork] }]);
  await online.close();
  await context.setOffline(true);

  const reopened = await context.newPage();
  await reopened.goto(server.origin);
  await reopened.getByRole('button', { name: user, exact: true }).click();
  await expectArtwork(bookCard(reopened));
  expect(fileRequests).toBe(0);
});
