import { copyFile, unlink, writeFile } from 'node:fs/promises';
import { test, expect, importBook, register } from './fixtures';
import { largeOriginal } from './large-original';
import { sourceInventory, storedRows } from './storage';

test('native large local import cancellation publishes no partial book and retains a real readable saved source', async ({ page, server }) => {
  const original = await largeOriginal();
  await page.goto(`${server.origin}/app/library`);
  await importBook(page, 'Retained cancellation original');
  const before = await sourceInventory(page);
  expect(before.available).toBe(1); expect(before.validSources).toBe(1); expect(before.blobSources).toBe(1);
  await page.getByRole('button', { name: 'Add book', exact: true }).click();
  await page.getByLabel('Choose local EPUB').setInputFiles(original);
  await expect(page.getByRole('button', { name: 'Cancel import', exact: true })).toBeEnabled();
  await expect.poll(async () => (await sourceInventory(page)).staged).toBe(1);
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Import cancelled.' })).toBeVisible();
  await expect.poll(() => sourceInventory(page)).toEqual(before);
  expect(await storedRows(page, 'events')).toEqual([]);
  await page.getByRole('heading', { name: 'Retained cancellation original', exact: true }).click();
  await page.getByRole('link', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Book reader', exact: true })).toHaveAttribute('data-reader-state', 'ready');
  await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Public chapter', exact: true })).toBeVisible();
});

test('Cancel download aborts a real Go streamed original, cleans staging chunks and retains the earlier verified chunked book', async ({ page, server }) => {
  const original = await largeOriginal();
  await register(page, server.origin, 'cancel-download');
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove offline', exact: true })).toBeEnabled();
  const before = await sourceInventory(page);
  expect(before.available).toBe(1); expect(before.validSources).toBe(1); expect(before.chunkedSources).toBe(1);
  expect(before.chunkBytes).toBeGreaterThan(0); expect(before.maxChunkBytes).toBeLessThanOrEqual(262144);
  const file = `${server.data}/documents/public.epub`, backup = `${server.data}/documents/public-before-cancel.epub`;
  await copyFile(file, backup);
  try {
    await copyFile(original, file);
    await writeFile(`${server.data}/slow-download`, 'throttle only actual book-002 handler output');
    await page.getByRole('link', { name: '← Back to Library', exact: true }).click();
    await page.getByRole('heading', { name: 'Public book 02', exact: true }).click();
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cancel download', exact: true })).toBeEnabled();
    await expect.poll(async () => { const inventory = await sourceInventory(page); return inventory.staged === 1 && inventory.chunkBytes > before.chunkBytes; }).toBe(true);
    await page.getByRole('button', { name: 'Cancel download', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Download cancelled.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Remove offline', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Public book 02', exact: true })).toBeFocused();
    await expect.poll(() => sourceInventory(page)).toEqual(before);
    expect(await storedRows(page, 'events')).toEqual([]);
    await page.getByRole('link', { name: '← Back to Library', exact: true }).click();
    await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
    await page.getByRole('link', { name: 'Resume', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Book reader', exact: true })).toHaveAttribute('data-reader-state', 'ready');
    await expect(page.frameLocator('iframe').first().getByRole('heading', { name: 'Public chapter', exact: true })).toBeVisible();
  } finally {
    await copyFile(backup, file);
    await unlink(backup);
    await unlink(`${server.data}/slow-download`).catch(() => undefined);
  }
});
