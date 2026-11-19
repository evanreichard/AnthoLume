import { epub, expect, register, test } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('book editor previews metadata without saving, saves cover and fields, and confirms shared deletion', async ({ page, server }, testInfo) => {
  await register(page, server.origin, 'book-editor');
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();
  await page.getByLabel('Choose EPUB to upload').setInputFiles({ name: 'editor.epub', mimeType: 'application/epub+zip', buffer: await epub('Disposable editor book') });
  await page.getByRole('link', { name: 'Open book', exact: true }).click();
  const edit = page.getByRole('button', { name: 'Edit book', exact: true });
  const cover = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 24;
    return canvas.toDataURL('image/jpeg').split(',')[1]!;
  });
  const longTitle = 'A collection of novels with a very long title that does not fit on one line on a mobile screen';
  let releaseSearch: () => void;
  const firstSearch = new Promise<void>(resolve => { releaseSearch = resolve; });
  await page.route('**/api/v1/metadata/search?*', async route => { await firstSearch; return route.fulfill({ json: [
    { id: 'OL1W', title: 'Looked-up title', author: 'New author', year: 2022, edition_id: 'OL2M', cover_id: 42 },
    { id: 'OL3W', title: longTitle, author: 'Another author', year: 2025 },
  ] }); });
  let releaseMatch: () => void;
  const firstMatch = new Promise<void>(resolve => { releaseMatch = resolve; });
  await page.route('**/api/v1/metadata/match?*', async route => {
    await firstMatch;
    await route.fulfill({ json: { id: 'OL1W', edition_id: 'OL2M', title: 'Looked-up title', author: '', description: 'Work synopsis from Open Library.', isbn10: '0765391198', isbn13: '9780765391193', cover_id: 42 } });
  });
  await page.route('**/api/v1/metadata/covers/42', route => route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(cover, 'base64') }));
  await expect(edit).toHaveText('');
  const remove = page.getByRole('button', { name: 'Delete from shared library', exact: true });
  await expect(remove).toHaveText('');
  const back = page.getByRole('main').getByRole('link', { name: 'Library', exact: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const [backBox, editBox, removeBox] = await Promise.all([back.boundingBox(), edit.boundingBox(), remove.boundingBox()]);
    expect(Math.abs(editBox!.y - backBox!.y)).toBeLessThanOrEqual(1);
    expect(removeBox!.y).toBeCloseTo(editBox!.y);
    expect(editBox!.x).toBeGreaterThan(backBox!.x + backBox!.width);
    expect(removeBox!.x).toBeCloseTo(editBox!.x + editBox!.width);
  }
  await edit.click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Edit book');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const editor = (await dialog.boundingBox())!;
    expect(editor.width).toBeLessThanOrEqual(width - 24);
    expect(Math.abs(editor.y - (844 - editor.y - editor.height))).toBeLessThanOrEqual(1);
    expect(editor.y).toBeGreaterThanOrEqual(23);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByLabel('Author', { exact: true }).fill('Author to preserve');
  await dialog.getByLabel('Synopsis', { exact: true }).fill('Original synopsis.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Original synopsis.', { exact: true })).toBeVisible();
  const identify = page.getByRole('group', { name: 'Book actions' }).getByRole('button', { name: 'Identify book' });
  await identify.click();
  await expect(dialog).toHaveAccessibleName('Identify Book');
  await expect(dialog.getByRole('heading', { name: 'Identify Book' })).toBeFocused();
  await page.keyboard.press('Tab');
  const closeDialog = dialog.getByRole('button', { name: 'Close dialog' });
  await expect(closeDialog).toBeFocused();
  expect(await closeDialog.evaluate(button => button.matches(':focus-visible'))).toBe(true);
  const sheet = (await dialog.boundingBox())!;
  expect(sheet.y).toBeGreaterThan(100);
  expect(sheet.y + sheet.height).toBeCloseTo(844);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(identify).toBeFocused();
  const openMatch = async () => {
    await identify.click();
    await dialog.getByRole('button', { name: 'Search', exact: true }).click();
    const result = dialog.getByRole('button', { name: /Looked-up title/ });
    await expect.poll(() => result.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(16);
    const title = dialog.getByRole('button', { name: new RegExp(longTitle) }).locator('strong');
    await expect(title).toHaveCSS('text-overflow', 'ellipsis');
    await expect(title).toHaveCSS('white-space', 'nowrap');
    expect(await title.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await expect(dialog.getByText('Search Open Library by title, author, or ISBN.', { exact: true })).toHaveCount(0);
    await dialog.screenshot({ path: testInfo.outputPath('identify-results-390.png'), animations: 'disabled' });
    await result.click();
    await expect(dialog.getByRole('button', { name: 'Title', exact: true })).toBeVisible();
  };
  const opening = openMatch();
  try {
    await expect(dialog.getByRole('status')).toHaveText('Searching…');
    const searchButton = dialog.getByRole('button', { name: 'Search', exact: true });
    await expect(searchButton).toBeDisabled();
    await expect(searchButton.locator('[class*="lookupSpinner"]')).toBeVisible();
    await dialog.screenshot({ path: testInfo.outputPath('identify-searching-390.png'), animations: 'disabled' });
  } finally { releaseSearch!(); }
  try {
    const preview = dialog.getByRole('region', { name: 'Match preview' });
    await expect(preview.getByRole('status')).toHaveText('Loading match preview…');
    await expect(dialog.getByRole('button', { name: 'Apply changes', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('searchbox')).toHaveCount(0);
    await expect(preview.locator('[class*="matchLoadingCover"]')).toBeVisible();
    await dialog.getByRole('button', { name: 'Back to results' }).click();
    const result = dialog.getByRole('button', { name: /Looked-up title/ });
    await expect(result).toBeFocused();
    await result.click();
    await expect(preview.getByRole('status')).toHaveText('Loading match preview…');
  } finally { releaseMatch!(); }
  await opening;
  await dialog.getByRole('button', { name: 'Back to results' }).click();
  await expect(dialog.getByRole('button', { name: /Looked-up title/ })).toBeFocused();
  await dialog.getByRole('button', { name: /Looked-up title/ }).click();
  await expect(dialog.getByText('Work synopsis from Open Library.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Synopsis', exact: true })).toHaveCount(0);
  const coverChoice = dialog.getByRole('button', { name: 'Edition cover', exact: true });
  await expect(coverChoice).toHaveAttribute('aria-pressed', 'true');
  await coverChoice.click();
  await expect(coverChoice).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: 'Title', exact: true }).click();
  const isbn10Choice = dialog.getByRole('button', { name: 'ISBN-10', exact: true });
  const isbnChoice = dialog.getByRole('button', { name: 'ISBN-13', exact: true });
  await expect(isbn10Choice).toHaveAttribute('aria-pressed', 'true');
  await expect(isbnChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Apply 3 changes', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Disposable editor book', exact: true })).toBeVisible();
  await openMatch();
  const image = dialog.getByRole('img', { name: 'Cover for Looked-up title' });
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(16);
  await expect(dialog.getByRole('button', { name: 'Author', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const synopsis = dialog.getByRole('button', { name: 'Synopsis', exact: true });
  await expect(synopsis).toHaveAttribute('aria-pressed', 'false');
  await synopsis.focus();
  await page.keyboard.press('Space');
  await expect(synopsis).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Apply 4 changes', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await dialog.screenshot({ path: testInfo.outputPath('identify-match-390.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await dialog.screenshot({ path: testInfo.outputPath('identify-match-desktop.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: 'Title', exact: true }).click();
  await isbnChoice.click();
  await expect(isbnChoice).toHaveAttribute('aria-pressed', 'false');
  await expect(dialog.getByRole('button', { name: 'Apply 4 changes', exact: true })).toBeEnabled();
  await isbnChoice.click();
  await expect(coverChoice).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Apply 5 changes', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const appliedTitle = page.getByRole('heading', { name: 'Looked-up title', exact: true });
  await expect(appliedTitle).toBeVisible();
  await expect(page.getByText('Work synopsis from Open Library.', { exact: true })).toBeVisible();
  await expect(page.getByText('Author to preserve', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('9780765391193', { exact: true })).toBeVisible();
  await openMatch();
  await expect(coverChoice).toBeEnabled();
  await expect(coverChoice).toHaveAttribute('aria-pressed', 'false');
  await expect(isbn10Choice).toHaveAttribute('aria-pressed', 'false');
  await expect(isbnChoice).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Delete from shared library', exact: true }).click();
  await expect(dialog.getByText(/for everyone/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(appliedTitle).toBeVisible();
  await page.getByRole('button', { name: 'Delete from shared library', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(`${server.origin}/library`);
  await expect(appliedTitle).toHaveCount(0);
});
