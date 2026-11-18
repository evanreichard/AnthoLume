import { epub, expect, register, test } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('book editor previews metadata without saving, saves cover and fields, and confirms shared deletion', async ({ page, server }) => {
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
  await page.route('**/api/v1/metadata/search?*', route => route.fulfill({ json: [{ id: '/works/OL1W', title: 'Looked-up title', author: 'New author', year: 2022, cover_id: 42 }] }));
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
  await dialog.getByRole('button', { name: 'Identify', exact: true }).click();
  await expect(dialog).toHaveAccessibleName('Identify Book');
  const sheet = (await dialog.boundingBox())!;
  expect(sheet.y).toBeGreaterThan(100);
  expect(sheet.y + sheet.height).toBeCloseTo(844);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveAccessibleName('Edit book');
  await expect(dialog.getByRole('button', { name: 'Identify', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Identify', exact: true }).click();
  await dialog.getByRole('button', { name: 'Search Open Library' }).click();
  await dialog.getByRole('button', { name: /Looked-up title/ }).click();
  await expect(dialog.getByRole('region', { name: 'Match preview' })).toBeVisible();
  await expect(dialog.getByRole('searchbox')).toHaveCount(0);
  const image = dialog.getByRole('img', { name: 'Cover for Looked-up title' });
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(16);
  await expect(dialog.getByRole('button', { name: 'Use this cover' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Use this match' }).click();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Looked-up title');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Disposable editor book', exact: true })).toBeVisible();
  await edit.click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Edited book');
  await dialog.getByLabel('Synopsis').fill('Saved from Book Details.');
  await dialog.getByRole('button', { name: 'Identify', exact: true }).click();
  await dialog.getByRole('button', { name: 'Search Open Library' }).click();
  await dialog.getByRole('button', { name: /Looked-up title/ }).click();
  await dialog.getByRole('button', { name: 'Use this cover' }).click();
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Edited book');
  await expect(dialog.getByRole('img', { name: 'New cover preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Edited book', exact: true })).toBeVisible();
  await expect(page.getByText('Saved from Book Details.')).toBeVisible();
  await page.getByRole('button', { name: 'Delete from shared library', exact: true }).click();
  await expect(dialog.getByText(/for everyone/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edited book', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete from shared library', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(`${server.origin}/app/library`);
  await expect(page.getByRole('heading', { name: 'Edited book', exact: true })).toHaveCount(0);
});
