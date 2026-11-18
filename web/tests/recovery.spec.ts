import { unlink, writeFile } from 'node:fs/promises';
import { test, expect, importBook } from './fixtures';
import { sourceInventory, storedRows } from './storage';
import type { Page, Locator } from '@playwright/test';

async function pointerOperable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  expect(await control.evaluate((button) => {
    const rect = button.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === button || !!hit && button.contains(hit);
  })).toBe(true);
}
async function appearanceAndRecovery(page: Page, recoveryName: string) {
  await expect(page.getByRole('region', { name: 'Book reader', exact: true })).toHaveAttribute('data-reader-state', 'ready');
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole('region', { name: 'Book reader', exact: true })).toHaveAttribute('data-reader-state', 'ready');
    await page.getByRole('button', { name: 'Reading progress and appearance', exact: true }).click();
    await page.getByRole('combobox', { name: 'Font', exact: true }).selectOption('Lato');
    await expect.poll(() => page.getByRole('region', { name: 'Book reader', exact: true }).evaluate((reader) => {
      const frame = reader.querySelector('iframe');
      const doc = frame?.contentDocument;
      if (reader.getAttribute('data-reader-state') !== 'ready' || !frame?.src.startsWith('blob:') || doc?.contentType !== 'application/xhtml+xml' || !doc.fonts) return false;
      return [...doc.fonts].some((font) => font.family === 'Lato' && font.status === 'loaded');
    })).toBe(true);
    await pointerOperable(page.getByRole('combobox', { name: 'Theme', exact: true }));
    await pointerOperable(page.getByRole('combobox', { name: 'Font', exact: true }));
    await pointerOperable(page.getByRole('slider', { name: 'Size', exact: true }));
    const done = page.getByRole('button', { name: 'Done', exact: true });
    await pointerOperable(done);
    await done.click();
    await expect(done).toHaveCount(0);
    const retry = page.getByRole('button', { name: recoveryName, exact: true });
    await pointerOperable(retry);
    const box = await retry.boundingBox();
    expect(box!.y).toBeGreaterThan(120);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 8);
    await expect.poll(async () => {
      const reader = await page.getByRole('region', { name: 'Book reader', exact: true }).boundingBox();
      const dock = await page.getByRole('region', { name: 'App update and recovery', exact: true }).boundingBox();
      return !!reader && !!dock && reader.y + reader.height <= dock.y;
    }).toBe(true);
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
    await pointerOperable(page.getByRole('button', { name: 'Public chapter', exact: true }));
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await pointerOperable(page.getByRole('button', { name: 'Previous page', exact: true }));
    await pointerOperable(page.getByRole('button', { name: 'Next page', exact: true }));
    await retry.click();
    await expect(page.getByRole('region', { name: 'Book reader', exact: true })).toHaveAttribute('data-reader-state', 'ready');
  }
}

test('denied page cleanup keeps visible worker Retry and recovers through applyUpdate without resetting storage', async ({ page, server }) => {
  await page.addInitScript(() => {
    localStorage.setItem('test:deny-cleanup', '1');
    localStorage.setItem('unrelated-retained', 'keep');
    const remove = Storage.prototype.removeItem;
    Object.defineProperty(Storage.prototype, 'removeItem', { configurable: true, value: function (this: Storage, key: string) {
      if (this === localStorage && key === 'readerSettings' && localStorage.getItem('test:deny-cleanup') === '1') throw new DOMException('Synthetic cleanup denial', 'SecurityError');
      return remove.call(this, key);
    } });
  });
  await page.goto(`${server.origin}/app/offline`);
  await expect(page.getByRole('button', { name: 'Retry update / recovery', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Import local EPUB', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'App update and recovery' })).toContainText('Your saved books have been retained');
  await page.evaluate(() => localStorage.setItem('test:deny-cleanup', '0'));
  await page.getByRole('button', { name: 'Retry update / recovery', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import local EPUB', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('unrelated-retained'))).toBe('keep');
});

test('sessionStorage reload denial leaves explicit Retry after a real worker update and retains actual books', async ({ page, server }) => {
  await page.goto(`${server.origin}/app/library`);
  await importBook(page, 'Recovery retained original');
  const books = await storedRows(page, 'books');
  await writeFile(`${server.data}/worker-update`, 'session-storage-denial');
  try {
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration('/'))!.update(); });
    await expect(page.getByRole('button', { name: 'Update app', exact: true })).toBeVisible();
    await page.evaluate(() => {
      sessionStorage.setItem('test:deny-reload', '1');
      const set = Storage.prototype.setItem;
      Object.defineProperty(Storage.prototype, 'setItem', { configurable: true, value: function (this: Storage, key: string, value: string) {
        if (this === sessionStorage && key.startsWith('antholume:retirement-reload:') && sessionStorage.getItem('test:deny-reload') === '1') throw new DOMException('Synthetic session storage denial. ' + 'Recovery retains saved books. '.repeat(80), 'SecurityError');
        return set.call(this, key, value);
      } });
    });
    await page.getByRole('button', { name: 'Update app', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry update / recovery', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'App update and recovery' })).toContainText('Update waiting');
    expect(await storedRows(page, 'books')).toEqual(books);
    await page.getByRole('heading', { name: 'Recovery retained original', exact: true }).click();
    await page.getByRole('link', { name: 'Resume', exact: true }).click();
    await expect(page.locator('iframe').first()).toBeVisible();
    await appearanceAndRecovery(page, 'Retry update / recovery');
    await page.getByRole('button', { name: 'Recovery details', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'App recovery details', exact: true })).toContainText('Saved books and pending events are retained');
    await page.getByRole('button', { name: 'Close recovery details', exact: true }).click();
    await expect(page.getByRole('region', { name: 'App update and recovery' })).toContainText('Update waiting');
    expect(await storedRows(page, 'books')).toEqual(books);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(() => sessionStorage.setItem('test:deny-reload', '0'));
    await page.getByRole('button', { name: 'Retry update / recovery', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Recovery retained original', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove offline', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Retry update / recovery', exact: true })).toHaveCount(0);
    expect(await storedRows(page, 'books')).toEqual(books);
  } finally { await unlink(`${server.data}/worker-update`).catch(() => undefined); }
});

test('anonymous session 503 warning leaves real Reader Appearance Done and recovery Reconnect actionable at phone and landscape sizes', async ({ page, server }) => {
  await page.goto(`${server.origin}/app/library`);
  await importBook(page, 'Session outage original');
  await page.getByRole('heading', { name: 'Session outage original', exact: true }).click();
  const sources = await sourceInventory(page);
  expect(sources.available).toBe(1); expect(sources.validSources).toBe(1);
  await writeFile(`${server.data}/session-unavailable`, 'actual bootstrap response fault');
  try {
    await page.reload();
    await expect(page.getByRole('alert').filter({ hasText: 'Session temporarily unavailable' }).first()).toBeVisible();
    await page.getByRole('link', { name: 'Resume', exact: true }).click();
    await appearanceAndRecovery(page, 'Reconnect');
    await page.getByRole('button', { name: 'Recovery details', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'App recovery details', exact: true });
    await expect(dialog).toContainText('Session temporarily unavailable');
    expect(await dialog.evaluate((element) => element.getBoundingClientRect().height <= innerHeight - 32)).toBe(true);
    await page.getByRole('button', { name: 'Close recovery details', exact: true }).click();
    await unlink(`${server.data}/session-unavailable`);
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(page.getByRole('region', { name: 'App update and recovery', exact: true })).toHaveCount(0);
    expect(await sourceInventory(page)).toEqual(sources);
  } finally { await unlink(`${server.data}/session-unavailable`).catch(() => undefined); }
});
