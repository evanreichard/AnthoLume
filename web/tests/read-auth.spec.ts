import { unlink, writeFile } from 'node:fs/promises';
import { test, expect, register } from './fixtures';

for (const binary of [false, true]) for (const valid of [false, true]) {
  test(`${binary ? 'binary' : 'metadata'} 401 ${valid ? 'validated' : 'malformed'} Problem keeps deliberate current-account auth semantics`, async ({ page, server }) => {
    await register(page, server.origin, `read-${binary}-${valid}-${Date.now()}`);
    const path = `/api/v1/documents/book-001${binary ? '/file' : ''}`;
    await writeFile(`${server.data}/read-fault`, JSON.stringify({ path, valid }));
    try {
      await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
      if (binary) {
        await page.getByRole('link', { name: 'Resume', exact: true }).click();
        await expect(page.getByRole('alert').filter({ hasText: /Original EPUB download failed|AbortError|Account changed/ })).toBeVisible();
        await page.getByRole('button', { name: 'Close', exact: true }).click();
      }
      if (valid) await expect(page.getByRole('link', { name: 'Sign in again', exact: true })).toBeVisible();
      else {
        await expect(page.getByRole('banner').getByRole('link', { name: 'Account', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Sign in again', exact: true })).toHaveCount(0);
        if (!binary) await expect(page.getByRole('alert')).toContainText('invalid response');
      }
    } finally { await unlink(`${server.data}/read-fault`).catch(() => undefined); }
  });
}
