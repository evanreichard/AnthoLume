import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { expect, register, test } from './fixtures';

test('backup requires catalog repair and restore directs invalid paths back to the source', async ({ page, server }, testInfo) => {
  const username = 'backup-repair-admin';
  await register(page, server.origin, username);
  const original = await readFile(`${server.data}/documents/public.epub`);
  const samples = createHash('md5');
  for (const offset of [0, ...Array.from({ length: 11 }, (_, i) => 1024 * 4 ** i)]) samples.update(original.subarray(offset, offset + 1024));
  const bookID = samples.digest('hex');
  const cover = await readFile(`${server.data}/covers/public.png`);
  const archive = `${server.data}/archive`;
  await mkdir(`${archive}/shelf`, { recursive: true });
  await writeFile(`${archive}/shelf/book.epub`, original);

  const db = new DatabaseSync(`${server.data}/browser.db`);
  try {
    db.prepare('UPDATE users SET admin=1 WHERE id=?').run(username);
    db.prepare("INSERT INTO storage_roots(id,label,path,managed) VALUES('archive','Archive',?,0)").run(archive);
    db.prepare('INSERT INTO documents(id, filepath) VALUES(?, ?)').run(bookID, '../book.epub');
    db.prepare("INSERT INTO reading_heads(user_id,document_id,revision,position,fraction) VALUES(?,'book_002',1,'synthetic-progress',0.5)").run(username);
  } finally { db.close(); }

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${server.origin}/admin/library`);
  const create = page.getByRole('button', { name: 'Create Backup', exact: true });
  await create.click();
  const dialog = page.getByRole('dialog');
  const download = dialog.getByRole('button', { name: 'Download' });
  await expect(dialog.getByRole('alert')).toContainText(`Document ${bookID} has an invalid book path.`);
  await expect(download).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Database', exact: true }).check();
  await expect(download).toBeDisabled();
  await dialog.getByLabel('Storage root').selectOption({ label: 'Archive' });
  const path = dialog.getByLabel('Relative file path');
  const relink = dialog.getByRole('button', { name: 'Relink path' });
  await path.fill('../book.epub');
  await expect(relink).toBeDisabled();
  await path.fill('shelf/book.epub');
  await relink.click();
  await expect(download).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  const live = new DatabaseSync(`${server.data}/browser.db`);
  try { live.prepare("UPDATE documents SET coverfile=? WHERE id='book_002'").run('/invalid/cover.png'); }
  finally { live.close(); }
  await create.click();
  await expect(dialog.getByRole('alert')).toContainText('Document book_002 has an invalid cover path.');
  await expect(dialog.getByLabel('Storage root')).toHaveCount(0);
  await expect(download).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Clear the reference' }).check();
  const clear = dialog.getByRole('button', { name: 'Clear path' });
  await expect(dialog.getByText('It does not delete any files or reading history.', { exact: false })).toBeVisible();
  await expect(clear).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'I confirm clearing this cover path.' }).check();
  await clear.click();
  await expect(download).toBeEnabled();
  await dialog.getByRole('radio', { name: 'Database', exact: true }).check();
  expect(await readFile(`${archive}/shelf/book.epub`)).toEqual(original);
  expect(await readFile(`${server.data}/covers/public.png`)).toEqual(cover);

  const downloaded = page.waitForEvent('download');
  await download.click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('antholume-backup.db');
  const brokenBackup = testInfo.outputPath('invalid-catalog.db');
  await file.saveAs(brokenBackup);
  const snapshot = new DatabaseSync(brokenBackup);
  try {
    expect(snapshot.prepare('SELECT filepath,storage_root_id FROM documents WHERE id=?').get(bookID)).toMatchObject({ filepath: 'shelf/book.epub', storage_root_id: 'archive' });
    expect(snapshot.prepare("SELECT coverfile FROM documents WHERE id='book_002'").get()).toMatchObject({ coverfile: null });
    expect(snapshot.prepare("SELECT position FROM reading_heads WHERE document_id='book_002' AND user_id=?").get(username)).toMatchObject({ position: 'synthetic-progress' });
    snapshot.prepare("UPDATE documents SET coverfile=? WHERE id='book_002'").run('/invalid/cover.png');
  } finally { snapshot.close(); }

  await page.getByRole('button', { name: 'Restore Backup', exact: true }).click();
  await dialog.getByLabel('Backup file').setInputFiles(brokenBackup);
  await dialog.getByRole('button', { name: 'Validate' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Document book_002 has an invalid cover path. Repair the catalog on the source server');
  await expect(dialog).toHaveAccessibleName('Restore Backup');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.route('**/api/v1/admin/backup/preview', route => route.fulfill({
    status: 500, contentType: 'application/problem+json',
    json: { status: 500, code: 'internal_error', type: 'about:blank', title: 'Internal Error', detail: 'Preview unavailable.' },
  }));
  await create.click();
  await expect(dialog.getByRole('alert')).toHaveText('Preview unavailable.');
  await expect(download).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Database', exact: true }).check();
  await expect(download).toBeEnabled();
});
