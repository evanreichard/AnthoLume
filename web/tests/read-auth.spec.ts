import { unlink, writeFile } from 'node:fs/promises';
import { test, expect, register } from './fixtures';

for (const binary of [false, true])
  for (const valid of [false, true]) {
    test(`${binary ? 'binary' : 'metadata'} 401 ${valid ? 'validated' : 'malformed'} Problem keeps deliberate current-account auth semantics`, async ({
      page,
      server,
    }) => {
      await register(page, server.origin, `read-${binary}-${valid}-${Date.now()}`);
      const path = `/api/v1/documents/book_001${binary ? '/file' : ''}`;
      await writeFile(`${server.data}/read-fault`, JSON.stringify({ path, valid }));
      try {
        await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
        if (binary) {
          await page.getByRole('link', { name: /^(Read|Resume)$/ }).click();
          if (!valid) {
            await expect(page.getByRole('alert')).toContainText('Could not load EPUB from the server');
            await page.getByRole('button', { name: 'Library', exact: true }).click();
          }
        }
        if (valid) await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
        else {
          await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
          await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toHaveCount(0);
          if (!binary) await expect(page.getByRole('alert')).toContainText('invalid response');
        }
      } finally {
        await unlink(`${server.data}/read-fault`).catch(() => undefined);
      }
    });
  }
