import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { expect, register, signIn, test } from './fixtures';

test('Import lists independent rules and opens editors on demand', async ({ page, server }, testInfo) => {
  await register(page, server.origin, 'auto-import-owner');
  const db = new DatabaseSync(`${server.data}/browser.db`);
  try { db.prepare("UPDATE users SET admin=1 WHERE id=?").run('auto-import-owner'); }
  finally { db.close(); }
  await page.setViewportSize({ width: 320, height: 800 });
  const archivePath = `${server.data}/archive`;
  await mkdir(archivePath);
  const storageDb = new DatabaseSync(`${server.data}/browser.db`);
  try { storageDb.prepare("INSERT INTO storage_roots(id,label,path,managed) VALUES('archive','Archive',?,0)").run(archivePath); }
  finally { storageDb.close(); }
  await page.goto(`${server.origin}/admin/library`);
  const roots = page.getByRole('region', { name: 'Storage Roots' });
  const imports = page.getByRole('region', { name: 'Import', exact: true });
  const dialog = page.getByRole('dialog');
  const manual = imports.getByRole('button', { name: 'Manual', exact: true });
  await expect(manual).toBeVisible();
  expect((await manual.boundingBox())?.height).toBe(44);
  expect((await manual.locator('span').boundingBox())?.height).toBe(32);
  await manual.click();
  await expect(dialog).toHaveAccessibleName('Manual Import');
  await expect(dialog.getByRole('combobox', { name: 'Destination', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await roots.getByRole('button', { name: 'Imports', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Auto-import' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(imports).toContainText('No auto-import rules yet.');
  await expect(page.getByRole('combobox', { name: 'Source' })).toHaveCount(0);
  for (const [name, folder] of [['New arrivals', 'Imports'], ['Archive books', 'Archive']]) {
    await imports.getByRole('button', { name: 'Auto', exact: true }).click();
    await expect(dialog).toHaveAccessibleName('Add Auto Import Rule');
    if (folder === 'Imports') {
      await page.setViewportSize({ width: 390, height: 844 });
      await dialog.screenshot({ path: testInfo.outputPath('auto-import-rule-390.png') });
      await page.setViewportSize({ width: 320, height: 800 });
    }
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await expect(dialog.getByRole('button', { name: 'Subfolder' })).toHaveCount(0);
    const source = dialog.getByRole('combobox', { name: 'Source', exact: true });
    await expect(source.getByRole('option')).toHaveText(['Archive', 'Imports']);
    await source.selectOption({ label: folder });
    const cadence = dialog.getByRole('combobox', { name: 'Schedule', exact: true });
    await expect(cadence).toHaveValue('changes');
    if (folder === 'Archive') await cadence.selectOption('six-hourly');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(imports.getByRole('button', { name, exact: true })).toHaveAccessibleDescription(new RegExp(folder));
  }
  await imports.screenshot({ path: testInfo.outputPath('import-rules-320.png') });
  await page.reload();
  await imports.getByRole('button', { name: 'New arrivals', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Schedule', exact: true })).toHaveValue('changes');
  const configured = await (await page.request.get(`${server.origin}/api/v1/admin/auto-import`)).json();
  expect(configured).toMatchObject([
    { settings: { name: 'Archive books', watch: false, interval_minutes: 360 } },
    { settings: { name: 'New arrivals', watch: true } },
  ]);
  const enable = dialog.getByRole('switch', { name: 'Enable', exact: true });
  await expect(enable).toBeChecked();
  await enable.focus();
  await page.keyboard.press('Space');
  await expect(enable).not.toBeChecked();
  await page.keyboard.press('Space');
  await expect(enable).toBeChecked();
  await expect(dialog.locator('dl').filter({ hasText: 'Last scan' }).locator('dt')).toHaveText(['Last scan', 'Next scan']);
  await expect(dialog.getByText('Not scheduled', { exact: true })).toBeVisible();
  const lastScan = dialog.locator('dl time').first();
  const previousScan = await lastScan.getAttribute('datetime');
  await dialog.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(lastScan).not.toHaveAttribute('datetime', previousScan!);
  const result = dialog.getByRole('status');
  await expect(result.getByText('Last Scan', { exact: true })).toBeVisible();
  await expect(result.getByText('Manual', { exact: true })).toBeVisible();
  await expect(result.locator('div').filter({ has: page.getByText('Found', { exact: true }) }).locator('dd')).toHaveText('0');
  await expect(result.locator('div').filter({ has: page.getByText('Added', { exact: true }) }).locator('dd')).toHaveText('0');
  await dialog.screenshot({ path: testInfo.outputPath('auto-import-result-320.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.screenshot({ path: testInfo.outputPath('auto-import-result-390.png') });
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(dialog.getByText('Not scheduled', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('auto-import-320.png') });
  const completedScan = await lastScan.getAttribute('datetime');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const ruleRow = imports.getByRole('button', { name: 'New arrivals', exact: true });
  await expect(ruleRow).not.toContainText('Last scan:');
  await expect(ruleRow.locator('time')).toHaveAttribute('datetime', completedScan!);
  await ruleRow.click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete rule' }).click();
  await expect(imports.getByRole('button', { name: 'New arrivals', exact: true })).toHaveCount(0);
  await expect(imports.getByRole('button', { name: 'Archive books', exact: true })).toBeVisible();
});

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
  await expect(page).toHaveURL(`${server.origin}/admin/library`);
  await expect(sections.getByRole('link')).toHaveText(['Library', 'Users', 'System', 'Logs']);
  await expect(sections.getByRole('link', { name: 'Library', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('region', { name: 'Import', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Backup & Restore', exact: true })).toBeVisible();
  await expect(page.getByLabel('Backup file')).toBeHidden();
  expect((await page.request.get(`${server.origin}/admin/import`)).status()).toBe(404);
  const title = page.getByRole('heading', { name: 'Administration', exact: true, level: 1 });
  await expect(title).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Settings', exact: true })).toHaveCount(0);
  await expect(page.getByText('What’s included', { exact: true })).toHaveCount(0);
  const storageTitle = page.getByRole('heading', { name: 'Storage Roots', exact: true });
  await expect(storageTitle).toBeVisible();
  expect((await storageTitle.boundingBox())!.y).toBeLessThan((await page.getByRole('heading', { name: 'Import', exact: true }).boundingBox())!.y);
  expect((await title.boundingBox())!.x).toBe((await sections.boundingBox())!.x);
  for (const tab of await sections.getByRole('link').all()) {
    expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await navigation.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(`${server.origin}/settings`);
  const libraryTab = sections.getByRole('link', { name: 'Library', exact: true });
  const tabStyle = (tab: typeof libraryTab) => tab.evaluate(element => {
    const { borderBottomColor, borderBottomWidth, fontWeight } = getComputedStyle(element);
    return { borderBottomColor, borderBottomWidth, fontWeight };
  });
  await navigation.getByRole('link', { name: 'Insights' }).click();
  const overviewTab = page.getByRole('navigation', { name: 'Insights sections' }).getByRole('link', { name: 'Overview' });
  await expect(overviewTab).toHaveAttribute('aria-current', 'page');
  const activeTab = await tabStyle(overviewTab);
  expect(activeTab.borderBottomWidth).toBe('2px');
  await navigation.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await expect(libraryTab).toHaveAttribute('aria-current', 'page');
  expect(await tabStyle(libraryTab)).toEqual(activeTab);
  await mkdir(`${server.data}/alternate-library`, { recursive: true });
  await Promise.all(Array.from({ length: 10 }, (_, index) => mkdir(`${server.data}/folder-${index}`)));
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Add Root', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Alternate library');
  await dialog.getByLabel('Directory', { exact: true }).fill(server.data);
  await dialog.getByRole('button', { name: 'Browse directories' }).click();
  await expect(dialog).toHaveAccessibleName('Select Folder');
  await expect(dialog.getByLabel('Directory', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'alternate-library', exact: true }).click();
  await expect(dialog.getByText('No subfolders.')).toBeVisible();
  const location = dialog.getByRole('status');
  await expect(location).toHaveText(`${server.data}/alternate-library`);
  await dialog.getByRole('button', { name: 'Up one level' }).click();
  await expect(location).toHaveText(server.data);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog.getByLabel('Directory', { exact: true })).toHaveValue(server.data);
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Alternate library');
  await dialog.getByRole('button', { name: 'Browse directories' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: 'alternate-library', exact: true }).waitFor();
  await page.screenshot({ path: testInfo.outputPath('directory-picker-390.png') });
  const filter = dialog.getByRole('searchbox', { name: 'Filter folders' });
  await filter.fill('no-match');
  await expect(dialog.getByText('No matching folders.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Clear folder filter' }).click();
  await expect(filter).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'alternate-library', exact: true })).toBeVisible();
  const selectFolder = dialog.getByRole('button', { name: 'Select', exact: true });
  const pickerHeight = (await dialog.boundingBox())!.height;
  const selectTop = (await selectFolder.boundingBox())!.y;
  await dialog.getByRole('button', { name: 'alternate-library', exact: true }).click();
  await expect(location).toHaveText(`${server.data}/alternate-library`);
  await expect(dialog.getByText('No subfolders.')).toBeVisible();
  expect((await dialog.boundingBox())!.height).toBe(pickerHeight);
  expect((await selectFolder.boundingBox())!.y).toBe(selectTop);
  await page.setViewportSize({ width: 320, height: 800 });
  await selectFolder.click();
  await expect(dialog.getByLabel('Directory', { exact: true })).toHaveValue(`${server.data}/alternate-library`);
  await expect(dialog.getByLabel('Ownership')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Storage Roots' }).getByRole('button', { name: 'Alternate library', exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Import actions' }).getByRole('button', { name: 'Manual', exact: true }).click();
  const source = page.getByRole('combobox', { name: 'Source', exact: true });
  await expect(source.getByRole('option', { name: 'Alternate library', exact: true })).toHaveCount(1);
  await expect(source.getByRole('option', { name: 'Imports', exact: true })).toHaveCount(1);
  await expect(source.getByRole('option', { name: 'Library', exact: true })).toHaveCount(0);
  const modes = page.getByRole('group', { name: 'Import mode' });
  const copy = modes.getByRole('button', { name: 'Copy', exact: true });
  const reference = modes.getByRole('button', { name: 'Reference', exact: true });
  await expect(copy).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByText('Destination', { exact: true })).toHaveCount(0);
  await reference.click();
  await expect(reference).toHaveAttribute('aria-pressed', 'true');
  await dialog.screenshot({ path: testInfo.outputPath('import-reference-320.png') });
  await copy.click();
  await dialog.screenshot({ path: testInfo.outputPath('import-copy-320.png') });
  await expect(dialog.getByRole('button', { name: 'Subfolder', exact: true })).toHaveCount(0);
  await mkdir(`${server.data}/imports/nested`, { recursive: true });
  const original = await readFile(`${server.data}/documents/public.epub`);
  await writeFile(`${server.data}/imports/nested/sample.epub`, original);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByText('1 EPUB ready to review')).toBeVisible();
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect(page.getByText('Import finished', { exact: true })).toBeVisible();
  await page.getByText('1 file result', { exact: true }).click();
  await expect(page.getByText('nested/sample.epub', { exact: true })).toBeVisible();
  await page.reload();
  await expect(sections.getByRole('link', { name: 'Library', exact: true })).toHaveAttribute('aria-current', 'page');
  const backupCard = page.getByRole('region', { name: 'Backup & Restore', exact: true });
  const backupActions = backupCard.getByRole('group', { name: 'Backup actions' });
  const createBackup = backupActions.getByRole('button', { name: 'Create Backup', exact: true });
  const restoreBackup = backupActions.getByRole('button', { name: 'Restore Backup', exact: true });
  await expect(backupCard.getByLabel('Backup contents')).toHaveCount(0);
  await expect(backupCard.getByRole('link')).toHaveCount(0);
  for (const control of [createBackup, restoreBackup]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await control.locator('span').boundingBox())!.height).toBe(32);
    await expect(control).toHaveText('');
  }
  await createBackup.click();
  await expect(dialog).toHaveAccessibleName('Create Backup');
  const backupContents = dialog.getByRole('group', { name: 'Backup contents' });
  const fullBackup = backupContents.getByRole('radio', { name: 'Database & Library', exact: true });
  const databaseBackup = backupContents.getByRole('radio', { name: 'Database', exact: true });
  await expect(fullBackup).toBeChecked();
  await expect(databaseBackup).not.toBeChecked();
  await expect(backupContents.getByRole('status')).toContainText(/book files · /);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await dialog.screenshot({ path: testInfo.outputPath(`create-backup-${width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 800 });
  const received = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const backup = await received;
  expect(backup.suggestedFilename()).toBe('antholume-backup.zip');
  const fullBackupPath = await backup.path();
  await createBackup.click();
  await fullBackup.focus();
  await page.keyboard.press('ArrowDown');
  await expect(databaseBackup).toBeChecked();
  const receivedDatabase = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  const database = await receivedDatabase;
  expect(database.suggestedFilename()).toBe('antholume-backup.db');
  const databasePath = await database.path();
  await expect(backupCard.getByRole('link')).toHaveCount(0);
  for (const [width, height, colorScheme] of [[320, 800, 'dark'], [390, 844, 'dark'], [1440, 900, 'light']] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: testInfo.outputPath(`library-${width}-${colorScheme}.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 320, height: 800 });
  const backupURL = new URL(backup.url());
  expect(backupURL.searchParams.get('account')).toBeTruthy();
  expect(backupURL.searchParams.get('generation')).toBeTruthy();
  const staleGeneration = new URL(backupURL);
  staleGeneration.searchParams.set('generation', 'stale');
  const rejected = await page.request.get(staleGeneration.toString());
  expect(rejected.status()).toBe(409);
  expect(await rejected.json()).toMatchObject({ code: 'stale_reading_generation' });
  const wrongAccount = new URL(backupURL);
  wrongAccount.searchParams.set('account', 'other-account');
  const denied = await page.request.get(wrongAccount.toString());
  expect(denied.status()).toBe(401);
  expect(await denied.json()).toMatchObject({ code: 'account_changed' });
  const archive = await JSZip.loadAsync(await readFile(fullBackupPath!));
  expect(await archive.file('documents/library/public.epub')?.async('nodebuffer')).toEqual(original);
  expect(archive.file('covers/public.png')).not.toBeNull();
  const databaseFile = testInfo.outputPath('backup.db');
  await writeFile(databaseFile, await archive.file('antholume.db')!.async('nodebuffer'));
  const snapshot = new DatabaseSync(databaseFile, { readOnly: true });
  try { expect(snapshot.prepare('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' }); }
  finally { snapshot.close(); }
  await sections.getByRole('link', { name: 'System' }).click();
  const serverCard = page.getByRole('region', { name: 'Server', exact: true });
  const maintenance = page.getByRole('region', { name: 'Maintenance', exact: true });
  const recentJobs = maintenance.locator('details').filter({ hasText: 'Recent jobs' });
  await expect(serverCard.getByText(/^Version:/)).toBeVisible();
  await expect(serverCard.getByText('Recent server logs')).toHaveCount(0);
  await expect(recentJobs.getByText('No maintenance jobs yet.')).toBeHidden();
  await recentJobs.getByText('Recent jobs', { exact: true }).click();
  await expect(recentJobs.getByText('No maintenance jobs yet.')).toBeVisible();
  await expect(maintenance.getByText('Never run', { exact: true })).toHaveCount(2);
  for (const name of ['Refresh reading statistics', 'Check database integrity']) {
    const started = page.waitForResponse(response => response.url().endsWith('/api/v1/admin/jobs') && response.request().method() === 'POST');
    await maintenance.getByRole('button', { name, exact: true }).click();
    expect((await started).status()).toBe(202);
    const row = maintenance.getByText(name, { exact: true }).locator('../..');
    await expect(row.getByRole('status')).toHaveText(/^Last ran on .* · Completed$/);
  }
  await sections.getByRole('link', { name: 'Users' }).click();
  await expect(recentJobs).toHaveCount(0);
  await sections.getByRole('link', { name: 'System' }).click();
  await expect(maintenance.getByText(/^Last ran on /)).toHaveCount(2);
  await expect(recentJobs.getByText(/Refresh reading statistics ·/)).toBeHidden();
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
  await expect(maintenance.getByText(/^Last ran on /)).toHaveCount(2);
  await recentJobs.getByText('Recent jobs', { exact: true }).click();
  await expect(recentJobs.getByText(/Refresh reading statistics ·/)).toBeVisible();
  await expect(recentJobs.getByText(/Check database integrity ·/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Administration', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await sections.getByRole('link', { name: 'Users' }).click();
  const createUser = page.getByRole('button', { name: 'Add User', exact: true });
  const target = await createUser.boundingBox();
  expect(target?.width).toBeGreaterThanOrEqual(44);
  expect(target?.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole('button', { name: 'Manage admin-owner' })).toHaveCount(0);
  await createUser.click();
  await expect(dialog).toHaveAccessibleName('Add User');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await dialog.getByLabel('Username').fill('admin-test-member');
  await dialog.getByLabel('Password').fill('synthetic-public-password');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Created admin-test-member.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Users\s*\d/ })).toBeVisible();

  const member = await browser.newContext();
  try {
    const tab = await member.newPage();
    await signIn(tab, server.origin, 'admin-test-member');
    await tab.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(tab.getByRole('link', { name: 'Administration', exact: true })).toHaveCount(0);
    await tab.goto(`${server.origin}/admin/users`);
    await expect(tab.getByText('Administrator access is required.')).toBeVisible();
    expect((await tab.request.get(`${server.origin}/api/v1/admin/users`)).status()).toBe(403);
    expect((await tab.request.get(`${server.origin}/api/v1/admin/backup`)).status()).toBe(403);
  } finally { await member.close(); }

  await page.getByRole('button', { name: 'Manage admin-test-member' }).getByText('admin-test-member', { exact: true }).click();
  const roles = dialog.getByRole('group', { name: 'Role' });
  const memberRole = roles.getByRole('radio', { name: 'Member', exact: true });
  const adminRole = roles.getByRole('radio', { name: 'Administrator', exact: true });
  await expect(memberRole).toBeChecked();
  await memberRole.focus();
  await page.keyboard.press('ArrowDown');
  await expect(adminRole).toBeChecked();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Updated admin-test-member.' })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  const manage = page.getByRole('button', { name: 'Manage admin-test-member' });
  await expect(manage).toContainText('Administrator');
  for (const [width, height, colorScheme] of [[320, 800, 'dark'], [390, 844, 'dark'], [1440, 900, 'light']] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme });
    await manage.click();
    await expect(adminRole).toBeChecked();
    const footer = dialog.locator('footer');
    const actions = await Promise.all(['Save', 'Cancel', 'Delete'].map(name =>
      footer.getByRole('button', { name, exact: true }).boundingBox()));
    expect(new Set(actions.map(box => box?.y)).size).toBe(1);
    await dialog.screenshot({ path: testInfo.outputPath(`manage-user-${width}-${colorScheme}.png`) });
    await footer.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await manage.click();
  await dialog.locator('footer').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Delete admin-test-member?');
  await dialog.getByLabel(/Type .* to confirm/).fill('wrong');
  await dialog.getByRole('button', { name: 'Delete user' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Enter the exact username to confirm.');
  await dialog.getByLabel(/Type .* to confirm/).fill('admin-test-member');
  await dialog.getByRole('button', { name: 'Delete user' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Deleted admin-test-member.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage admin-test-member' })).toHaveCount(0);

  await mkdir(`${server.data}/logs`, { recursive: true });
  const logFixture = (status: number, level: string) => JSON.stringify({ time: '2026-03-10T12:00:00Z', type: 'access', status, level, msg: `HTTP ${status}${status === 410 ? ` ${'long request path '.repeat(20)}` : ''}`, latency: '2ms', authorization: 'not-for-the-browser' });
  await writeFile(`${server.data}/logs/antholume.log`, [...Array(15).fill(logFixture(200, 'info')), logFixture(503, 'warn')].join('\n') + '\n');
  await writeFile(`${server.data}/logs/antholume-2026-03-09T00-00-00.000.log`, logFixture(410, 'info') + '\n');
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto(`${server.origin}/admin/logs`);
  await expect(page).toHaveURL(`${server.origin}/admin/logs`);
  await expect(sections.getByRole('link', { name: 'Logs', exact: true })).toHaveAttribute('aria-current', 'page');
  const logViewer = page.getByRole('region', { name: 'Logs', exact: true });
  const entries = logViewer.getByRole('list', { name: 'Log events' }).getByRole('listitem');
  await expect(entries).toHaveCount(15);
  await expect(entries.first()).toContainText('HTTP 503');
  const eventSearch = logViewer.getByRole('searchbox', { name: 'Search log events' });
  const loadOlder = logViewer.getByRole('button', { name: 'Load older logs' });
  await loadOlder.scrollIntoViewIfNeeded();
  await expect(entries).toHaveCount(17);
  await expect(entries.first()).toContainText('HTTP 503');
  await expect(entries.last()).toContainText('HTTP 410');
  await entries.last().locator('summary').click();
  const longDetails = entries.last().locator('pre');
  expect(await longDetails.evaluate(node => { node.scrollLeft = 80; return node.scrollLeft; })).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect.poll(async () => (await sections.boundingBox())?.y).toBe(0);
  const tabsBox = (await sections.boundingBox())!;
  const searchBox = (await eventSearch.boundingBox())!;
  expect(searchBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height);
  expect(searchBox.y + searchBox.height).toBeLessThan(500);
  await logViewer.getByRole('combobox', { name: 'Log level' }).selectOption('warn');
  await expect(entries).toHaveCount(1);
  await eventSearch.fill('404');
  await eventSearch.press('Enter');
  await expect(logViewer.getByText('No matching events.')).toBeVisible();
  await eventSearch.fill('2ms');
  await eventSearch.press('Enter');
  await expect(entries).toHaveCount(1);
  await entries.first().getByText('HTTP 503', { exact: true }).click();
  await expect(entries.first().getByText(/"latency": "2ms"/)).toBeVisible();
  await expect(entries.first().getByText(/not-for-the-browser/)).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const toolbar = await Promise.all([
    eventSearch.boundingBox(),
    logViewer.getByRole('combobox', { name: 'Log level' }).boundingBox(),
    logViewer.getByRole('button', { name: 'Refresh logs' }).boundingBox(),
  ]);
  expect(new Set(toolbar.map(box => box?.y)).size).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('logs-390.png') });
  await page.setViewportSize({ width: 1280, height: 844 });
  const railLink = navigation.getByRole('link', { name: 'Library', exact: true });
  const background = () => railLink.evaluate(node => getComputedStyle(node).backgroundColor);
  const idle = await background();
  await railLink.hover();
  expect(await background()).not.toBe(idle);
  await page.screenshot({ path: testInfo.outputPath('logs-desktop-hover.png') });
  expect((await page.request.post(`${server.origin}/admin`)).status()).toBe(404);

  await sections.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByLabel('Backup file')).toBeHidden();
  await restoreBackup.click();
  await expect(dialog).toHaveAccessibleName('Restore Backup');
  const applyRestore = async () => {
    await expect(async () => {
      const applied = page.waitForResponse(response => response.url().endsWith('/api/v1/admin/restore') && response.request().method() === 'PATCH');
      await dialog.getByRole('button', { name: 'Restore backup' }).click();
      expect((await applied).status()).toBe(204);
    }).toPass({ timeout: 5000 });
    await expect(page).toHaveURL(`${server.origin}/login`);
  };
  const changed = Buffer.from('replaced after backup');
  await writeFile(`${server.data}/documents/public.epub`, changed);
  await page.getByLabel('Backup file').setInputFiles({name: 'invalid.zip', mimeType: 'application/zip', buffer: Buffer.from('not an archive')});
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Choose a valid AnthoLume backup.');
  expect(await (await page.request.get(`${server.origin}/api/v1/documents/book_001/file`)).body()).toEqual(changed);
  await page.getByLabel('Backup file').setInputFiles((await backup.path())!);
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(dialog.getByText(/library files will be restored/)).toBeVisible();
  await expect(dialog.getByLabel('Restore library to')).toHaveCount(0);
  await dialog.getByLabel('Type RESTORE to confirm').fill('RESTORE');
  await applyRestore();
  await signIn(page, server.origin, 'admin-owner');
  const restored = await page.request.get(`${server.origin}/api/v1/documents/book_001/file`);
  expect(restored.status()).toBe(200);
  expect(await restored.body()).toEqual(original);
  expect(await (await page.request.get(`${server.origin}/api/v1/documents/book_001/cover`)).body()).toEqual(await archive.file('covers/public.png')!.async('nodebuffer'));
  await expect(stat(`${server.data}/backups`)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(`${server.data}/documents/public.epub`)).toEqual(changed);

  expect((await page.request.get(`${server.origin}/admin/backups`)).status()).toBe(404);
  await page.goto(`${server.origin}/admin/library`);
  await restoreBackup.click();
  await page.getByLabel('Backup file').setInputFiles(databasePath!);
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(dialog.getByText(/No library files are included/)).toBeVisible();
  await dialog.getByLabel('Type RESTORE to confirm').fill('RESTORE');
  await applyRestore();
  await signIn(page, server.origin, 'admin-owner');
  expect(await (await page.request.get(`${server.origin}/api/v1/documents/book_001/file`)).body()).toEqual(changed);
});

test('Make Library previews the change and only applies after confirmation', async ({ page, server }, testInfo) => {
  await register(page, server.origin, 'library-owner');
  const sourcePath = `${server.data}/incoming-library`;
  await mkdir(sourcePath);
  const db = new DatabaseSync(`${server.data}/browser.db`);
  try {
    db.prepare('UPDATE users SET admin=1 WHERE id=?').run('library-owner');
    db.prepare("INSERT INTO storage_roots(id,label,legacy_path,managed) VALUES('incoming','Incoming library',?,0)").run(`${sourcePath}-missing`);
    db.exec("INSERT INTO documents(id,filepath,storage_root_id) VALUES('unavailable-book','book.epub','incoming')");
  } finally { db.close(); }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${server.origin}/admin/library`);
  const roots = page.getByRole('region', { name: 'Storage Roots' });
  const dialog = page.getByRole('dialog');
  const source = roots.getByRole('button', { name: 'Incoming library', exact: true });
  await expect(source).toHaveAccessibleDescription(/Directory unavailable on the server/);
  await expect(roots.getByRole('button', { name: 'Library', exact: true })).not.toHaveAccessibleDescription(/Directory unavailable on the server/);
  await source.click();
  await expect(dialog.getByText('1 book in catalog', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Directory', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Directory', { exact: true }).fill(sourcePath);
  const actions = await Promise.all(['Save', 'Make Library', 'Cancel'].map(name => dialog.getByRole('button', { name, exact: true }).boundingBox()));
  expect(actions.map(box => box?.height)).toEqual([44, 44, 44]);
  expect(new Set(actions.map(box => box?.y)).size).toBe(1);
  await dialog.screenshot({ path: testInfo.outputPath('edit-root-actions-320.png') });
  await dialog.getByRole('button', { name: 'Make Library', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Make this folder Library?');
  await expect(dialog).toContainText('No files will move.');
  await dialog.screenshot({ path: testInfo.outputPath('make-library-320.png') });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Edit Root');
  await expect(dialog.getByLabel('Directory', { exact: true })).toHaveValue(sourcePath);
  const saved = await (await page.request.get(`${server.origin}/api/v1/admin/storage-roots`)).json();
  expect(saved.find((root: { id: string }) => root.id === 'incoming').path).toBe('');
  await dialog.getByRole('button', { name: 'Make Library', exact: true }).click();
  await dialog.getByRole('button', { name: 'Make Library', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(roots.getByRole('button', { name: 'Former Library', exact: true })).toBeVisible();
  await expect(roots.getByRole('button', { name: 'Library', exact: true })).toHaveAccessibleDescription(new RegExp(sourcePath));
});

test('Make Library offers an explicit merge when the proposed folder already is Library', async ({ page, server }) => {
  await register(page, server.origin, 'merge-owner');
  const libraryPath = `${server.data}/documents`;
  const db = new DatabaseSync(`${server.data}/browser.db`);
  try {
    db.prepare("UPDATE users SET admin=1 WHERE id='merge-owner'").run();
    db.prepare("UPDATE storage_roots SET path=? WHERE id='library'").run(libraryPath);
    db.exec("INSERT INTO storage_roots(id,label,managed) VALUES('incoming','Incoming library',0); INSERT INTO documents(id,filepath,storage_root_id) VALUES('incoming-book','public.epub','incoming')");
  } finally { db.close(); }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${server.origin}/admin/library`);
  const roots = page.getByRole('region', { name: 'Storage Roots' });
  const incoming = roots.getByRole('button', { name: 'Incoming library', exact: true });
  await expect(incoming).toBeVisible();
  const former = roots.getByRole('button', { name: 'Former Library', exact: true });
  const formerCount = await former.count();
  await incoming.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Directory', { exact: true }).fill(libraryPath);
  await dialog.getByRole('button', { name: 'Make Library', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Merge into Library?');
  await expect(dialog).toContainText('These books will be included in Library file backups.');
  await expect(dialog).toContainText('No files will move.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Edit Root');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(incoming).toBeVisible();
  await incoming.click();
  await dialog.getByRole('button', { name: 'Make Library', exact: true }).click();
  await dialog.getByRole('button', { name: 'Merge into Library', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(incoming).toHaveCount(0);
  await expect(former).toHaveCount(formerCount);
  await expect(roots.getByRole('button', { name: 'Library', exact: true })).toHaveAccessibleDescription(new RegExp(libraryPath));
});
