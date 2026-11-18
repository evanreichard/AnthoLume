import { DatabaseSync } from 'node:sqlite';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { expect, register, signIn, test } from './fixtures';

test('administrators manage users while members cannot open Administration', async ({ page, browser, server }, testInfo) => {
  await register(page, server.origin, 'admin-owner');
  const db = new DatabaseSync(`${server.data}/browser.db`);
  try { db.prepare('UPDATE users SET admin=1 WHERE id=?').run('admin-owner'); }
  finally { db.close(); }
  await page.reload();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 800 });
  const header = page.getByRole('main').locator('header').filter({ has: page.getByRole('heading', { name: 'Settings', exact: true }) });
  const adminLink = header.getByRole('link', { name: 'Administration', exact: true });
  await expect(adminLink).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tools', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Export local books', exact: true })).toHaveCount(0);
  const [settingsTitle, adminPill] = await Promise.all([header.getByRole('heading').boundingBox(), adminLink.boundingBox()]);
  expect(adminPill!.height).toBeGreaterThanOrEqual(44);
  expect(adminPill!.x).toBeGreaterThan(settingsTitle!.x + settingsTitle!.width);
  expect(Math.abs(adminPill!.y + adminPill!.height / 2 - settingsTitle!.y - settingsTitle!.height / 2)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await adminLink.click();
  const sections = page.getByRole('navigation', { name: 'Administration sections' });
  await expect(page).toHaveURL(`${server.origin}/app/admin/library`);
  await expect(sections.getByRole('link')).toHaveText(['Library', 'Users', 'System']);
  await expect(sections.getByRole('link', { name: 'Library', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Import books' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Backup & restore' })).toBeVisible();
  await expect(page.getByLabel('Backup file')).toBeHidden();
  await page.goto(`${server.origin}/app/admin/import`);
  await expect(page).toHaveURL(`${server.origin}/app/admin/library`);
  const back = page.getByRole('link', { name: 'Back to Settings' });
  const title = page.getByRole('heading', { name: 'Administration', exact: true, level: 1 });
  await expect(back).toBeVisible();
  await expect(title).toBeVisible();
  const [pill, heading] = await Promise.all([back.boundingBox(), title.boundingBox()]);
  expect(pill!.height).toBeGreaterThanOrEqual(44);
  expect(pill!.x + pill!.width).toBeLessThan(heading!.x);
  expect(Math.abs(pill!.y + pill!.height / 2 - heading!.y - heading!.height / 2)).toBeLessThan(1);
  for (const tab of await sections.getByRole('link').all()) {
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await back.click();
  await expect(page).toHaveURL(`${server.origin}/app/settings`);
  const libraryTab = sections.getByRole('link', { name: 'Library', exact: true });
  const tabStyle = (tab: typeof libraryTab) => tab.evaluate(element => {
    const { borderBottomColor, borderBottomWidth, fontWeight } = getComputedStyle(element);
    return { borderBottomColor, borderBottomWidth, fontWeight };
  });
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await navigation.getByRole('link', { name: 'Insights' }).click();
  const overviewTab = page.getByRole('navigation', { name: 'Insights sections' }).getByRole('link', { name: 'Overview' });
  await expect(overviewTab).toHaveAttribute('aria-current', 'page');
  const activeTab = await tabStyle(overviewTab);
  expect(activeTab.borderBottomWidth).toBe('2px');
  await navigation.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await expect(libraryTab).toHaveAttribute('aria-current', 'page');
  expect(await tabStyle(libraryTab)).toEqual(activeTab);
  await mkdir(`${server.data}/imports`, { recursive: true });
  const original = await readFile(`${server.data}/documents/public.epub`);
  await writeFile(`${server.data}/imports/sample.epub`, original);
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByText('1 EPUB ready to review')).toBeVisible();
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect(page.getByText('Import finished', { exact: true })).toBeVisible();
  await page.getByText('1 file result', { exact: true }).click();
  await expect(page.getByText('sample.epub', { exact: true })).toBeVisible();
  await page.reload();
  await expect(sections.getByRole('link', { name: 'Library', exact: true })).toHaveAttribute('aria-current', 'page');
  const backupContents = page.getByLabel('Backup contents');
  const createBackup = page.getByRole('button', { name: 'Create backup' });
  await expect(backupContents).toHaveValue('full');
  expect((await backupContents.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await createBackup.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await createBackup.locator('span').boundingBox())!.height).toBe(32);
  await createBackup.click();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  const backupCard = page.getByRole('region', { name: 'Backup & restore', exact: true });
  const downloadBackup = backupCard.getByRole('link', { name: 'Download backup' });
  await expect(downloadBackup).toBeVisible();
  await expect(backupCard.getByRole('button', { name: 'Create backup' })).toBeVisible();
  for (const [width, height, colorScheme] of [[320, 800, 'dark'], [390, 844, 'dark'], [1440, 900, 'light']] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: testInfo.outputPath(`library-${width}-${colorScheme}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 320, height: 800 });
  const received = page.waitForEvent('download');
  await downloadBackup.click();
  const backup = await received;
  expect(backup.suggestedFilename()).toBe('antholume-backup.zip');
  const archive = await JSZip.loadAsync(await readFile((await backup.path())!));
  expect(await archive.file('documents/public.epub')?.async('nodebuffer')).toEqual(original);
  expect(archive.file('covers/public.png')).not.toBeNull();
  const databaseFile = testInfo.outputPath('backup.db');
  await writeFile(databaseFile, await archive.file('antholume.db')!.async('nodebuffer'));
  const snapshot = new DatabaseSync(databaseFile, { readOnly: true });
  try { expect(snapshot.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' }); }
  finally { snapshot.close(); }
  await sections.getByRole('link', { name: 'System' }).click();
  const serverCard = page.getByRole('region', { name: 'Server', exact: true });
  const maintenance = page.getByRole('region', { name: 'Maintenance', exact: true });
  const recentJobs = page.getByRole('region', { name: 'Recent jobs', exact: true });
  await expect(serverCard.getByText(/^Version:/)).toBeVisible();
  await expect(serverCard.getByText('Recent server logs')).toBeVisible();
  await expect(serverCard.getByLabel('Filter logs')).toBeHidden();
  await expect(recentJobs.getByText('No maintenance jobs yet.')).toBeHidden();
  await recentJobs.getByText('Recent jobs', { exact: true }).click();
  await expect(recentJobs.getByText('No maintenance jobs yet.')).toBeVisible();
  const started = page.waitForResponse(response => response.url().endsWith('/api/v1/admin/jobs') && response.request().method() === 'POST');
  await maintenance.getByRole('button', { name: 'Refresh statistics' }).click();
  expect((await started).status()).toBe(202);
  await sections.getByRole('link', { name: 'Users' }).click();
  await expect(recentJobs).toHaveCount(0);
  await sections.getByRole('link', { name: 'System' }).click();
  await expect(recentJobs.getByRole('status').filter({ hasText: /^Completed$/ })).toBeVisible();
  await expect(recentJobs.getByText('Statistics refresh', { exact: true })).toBeHidden();
  for (const [width, colorScheme] of [[320, 'dark'], [390, 'light'], [1440, 'light']] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: testInfo.outputPath(`system-${width}-${colorScheme}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await server.stop();
  await server.start();
  await page.reload();
  await expect(recentJobs.getByRole('status').filter({ hasText: /^Completed$/ })).toBeVisible();
  await recentJobs.getByText('Recent jobs', { exact: true }).click();
  await expect(recentJobs.getByText('Statistics refresh', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Administration', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await sections.getByRole('link', { name: 'Users' }).click();
  const createUser = page.getByRole('button', { name: 'Create user' });
  const target = await createUser.boundingBox();
  expect(target?.width).toBeGreaterThanOrEqual(44);
  expect(target?.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole('button', { name: 'Manage admin-owner' })).toHaveCount(0);
  await createUser.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Username').fill('admin-test-member');
  await dialog.getByLabel('Password').fill('synthetic-public-password');
  await dialog.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Created admin-test-member.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Users\s*\d/ })).toBeVisible();

  const member = await browser.newContext();
  try {
    const tab = await member.newPage();
    await signIn(tab, server.origin, 'admin-test-member');
    await tab.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(tab.getByRole('link', { name: 'Administration', exact: true })).toHaveCount(0);
    await tab.goto(`${server.origin}/app/admin/users`);
    await expect(tab.getByText('Administrator access is required.')).toBeVisible();
    expect((await tab.request.get(`${server.origin}/api/v1/admin/users`)).status()).toBe(403);
    expect((await tab.request.get(`${server.origin}/api/v1/admin/backup`)).status()).toBe(403);
  } finally { await member.close(); }

  await page.getByRole('button', { name: 'Manage admin-test-member' }).getByText('admin-test-member', { exact: true }).click();
  await dialog.getByLabel('Administrator').check();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Updated admin-test-member.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete admin-test-member' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage admin-test-member' }).click();
  await dialog.getByRole('button', { name: 'Delete admin-test-member' }).click();
  await dialog.getByLabel(/Type .* to confirm/).fill('wrong');
  await dialog.getByRole('button', { name: 'Delete user' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Enter the exact username to confirm.');
  await dialog.getByLabel(/Type .* to confirm/).fill('admin-test-member');
  await dialog.getByRole('button', { name: 'Delete user' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Deleted admin-test-member.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage admin-test-member' })).toHaveCount(0);

  await page.goto(`${server.origin}/admin/logs`);
  await expect(page).toHaveURL(`${server.origin}/app/admin/system`);
  await expect(page.getByText('Recent server logs', { exact: true })).toBeVisible();
  expect((await page.request.post(`${server.origin}/admin`)).status()).toBe(404);

  await sections.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByLabel('Backup file')).toBeHidden();
  await page.getByText('Restore a backup', { exact: true }).click();
  const changed = Buffer.from('replaced after backup');
  await writeFile(`${server.data}/documents/public.epub`, changed);
  await page.getByLabel('Backup file').setInputFiles({name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('not an archive')});
  await page.getByRole('button', { name: 'Validate backup' }).click();
  await expect(page.getByRole('alert')).toHaveText('Choose a valid AnthoLume backup.');
  expect(await (await page.request.get(`${server.origin}/api/v1/documents/book-001/file`)).body()).toEqual(changed);
  await page.getByLabel('Backup file').setInputFiles((await backup.path())!);
  await page.getByRole('button', { name: 'Validate backup' }).click();
  await expect(dialog.getByText(/library files will be restored/)).toBeVisible();
  await dialog.getByLabel('Type RESTORE to confirm').fill('RESTORE');
  await dialog.getByRole('button', { name: 'Restore backup' }).click();
  await expect(page).toHaveURL(`${server.origin}/app/login`);
  await signIn(page, server.origin, 'admin-owner');
  const restored = await page.request.get(`${server.origin}/api/v1/documents/book-001/file`);
  expect(restored.status()).toBe(200);
  expect(await restored.body()).toEqual(original);
  expect(await (await page.request.get(`${server.origin}/api/v1/documents/book-001/cover`)).body()).toEqual(await archive.file('covers/public.png')!.async('nodebuffer'));
  const backups = `${server.data}/backups`;
  const rollback = (await readdir(backups)).find(name => name.startsWith('before-restore-'));
  expect(rollback).toBeDefined();
  const rollbackDB = new DatabaseSync(`${backups}/${rollback}/antholume.db`, { readOnly: true });
  try {
    expect(rollbackDB.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
    expect(rollbackDB.prepare('SELECT filepath FROM documents WHERE id=?').get('book-001')).toEqual({ filepath: 'public.epub' });
    expect(await readFile(`${server.data}/documents/public.epub`)).toEqual(changed);
  } finally { rollbackDB.close(); }

  await page.goto(`${server.origin}/app/admin/backups`);
  await expect(page).toHaveURL(`${server.origin}/app/admin/library`);
  await page.getByText('Restore a backup', { exact: true }).click();
  await page.getByLabel('Backup file').setInputFiles(`${backups}/${rollback}/antholume.db`);
  await page.getByRole('button', { name: 'Validate backup' }).click();
  await expect(dialog.getByText(/No library files are included/)).toBeVisible();
  await dialog.getByLabel('Type RESTORE to confirm').fill('RESTORE');
  await dialog.getByRole('button', { name: 'Restore backup' }).click();
  await expect(page).toHaveURL(`${server.origin}/app/login`);
  await signIn(page, server.origin, 'admin-owner');
  expect(await (await page.request.get(`${server.origin}/api/v1/documents/book-001/file`)).body()).toEqual(changed);
});
