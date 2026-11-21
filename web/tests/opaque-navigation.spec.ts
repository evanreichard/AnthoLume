import { DatabaseSync } from 'node:sqlite';
import { expect, register, test } from './fixtures';

test('slash and literal percent-encoded slash navigate to distinct books and reader resources', async ({ page, server }) => {
  await register(page, server.origin, 'opaque-reader');
  const books = [['a/b', 'Opaque slash'], ['a%2Fb', 'Opaque literal percent']];
  const db = new DatabaseSync(`${server.data}/browser.db`);
  try {
    const insert = db.prepare("INSERT INTO documents(id, title, filepath) VALUES(?, ?, 'public.epub')");
    for (const [id, title] of books) insert.run(id, title);
  } finally { db.close(); }
  for (const [id, title] of books) {
    await page.goto(`${server.origin}/library?q=Opaque`);
    await page.getByRole('heading', { name: title, exact: true }).click();
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    const file = page.waitForResponse(`${server.origin}/api/v1/documents/${encodeURIComponent(id)}/file`);
    await page.getByRole('link', { name: 'Read', exact: true }).click();
    expect((await file).ok()).toBe(true);
    await expect(page.getByRole('region', { name: 'Book reader' })).toHaveAttribute('data-reader-state', 'ready');
  }
});
