import { readFile } from 'node:fs/promises';
import { epub, expect, register, test } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('book details show file information and download the original EPUB', async ({ page, server }) => {
  await register(page, server.origin, 'book-info');
  const original = await epub('Downloadable edition');
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();
  await page.getByLabel('Choose EPUB to upload').setInputFiles({ name: 'original.epub', mimeType: 'application/epub+zip', buffer: original });
  await page.getByRole('link', { name: 'Open book', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  const more = page.getByRole('button', { name: 'More', exact: true });
  const info = page.getByRole('button', { name: 'Info', exact: true });
  const exportFile = page.getByRole('link', { name: 'Export', exact: true });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(info).toBeHidden();
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(info).toBeVisible();
  await expect(exportFile).toBeVisible();
  await info.focus();
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
  await expect(more).toBeFocused();
  await more.click();
  await page.getByRole('heading', { name: 'Downloadable edition', exact: true }).click({ position: { x: 5, y: 5 } });
  await expect(info).toBeHidden();
  await more.click();
  await expect(info).toBeFocused();
  // Safari Tap - A button tap can blur the focused item without focusing a new element before click.
  await info.evaluate(button => button.addEventListener('mousedown', event => {
    event.preventDefault();
    button.blur();
  }, { once: true }));
  const panel = page.getByRole('group', { name: 'More actions' });
  const panelBox = (await panel.boundingBox())!, infoBox = (await info.boundingBox())!;
  await page.mouse.click(panelBox.x + panelBox.width - 12, infoBox.y + infoBox.height / 2);
  const dialog = page.getByRole('dialog', { name: 'Book information' });
  await expect(dialog.getByText('Downloadable edition', { exact: true })).toBeVisible();
  await expect(dialog.getByText(`${original.length.toLocaleString('en-US')} bytes`, { exact: true })).toBeVisible();
  await expect(dialog.getByText('Catalog ID', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(more).toBeFocused();
  await expect(info).toBeHidden();
  await more.click();
  const pending = page.waitForEvent('download');
  await exportFile.click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.epub$/i);
  expect(await readFile((await download.path())!)).toEqual(original);
  await expect(exportFile).toBeHidden();
});

test('book editor previews metadata without saving, saves cover and fields, and confirms shared deletion', async ({ page, server }, testInfo) => {
  await register(page, server.origin, 'book-editor');
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();
  await page.getByLabel('Choose EPUB to upload').setInputFiles({ name: 'editor.epub', mimeType: 'application/epub+zip', buffer: await epub('Disposable editor book') });
  await page.getByRole('link', { name: 'Open book', exact: true }).click();
  const more = page.getByRole('button', { name: 'More', exact: true });
  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  const remove = page.getByRole('button', { name: 'Delete', exact: true });
  const jpeg = (width: number) => page.evaluate(width => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = width * 1.5;
    return canvas.toDataURL('image/jpeg').split(',')[1]!;
  }, width);
  const cover = await jpeg(16);
  const largeCover = await jpeg(160);
  const longTitle = 'A collection of novels with a very long title that does not fit on one line on a mobile screen';
  let releaseSearch: () => void;
  const firstSearch = new Promise<void>(resolve => { releaseSearch = resolve; });
  await page.route('**/api/v1/metadata/search?*', async route => { await firstSearch; return route.fulfill({ json: [
    { provider: 'openlibrary', id: 'OL1W', title: 'Looked-up title', author: 'New author', year: 2022, edition_id: 'OL2M', cover_id: 42 },
    { provider: 'openlibrary', id: 'OL3W', title: longTitle, author: 'Another author', year: 2025 },
  ] }); });
  let releaseMatch: () => void;
  const firstMatch = new Promise<void>(resolve => { releaseMatch = resolve; });
  await page.route('**/api/v1/metadata/match?*', async route => {
    expect(new URL(route.request().url()).searchParams.get('provider')).toBe('openlibrary');
    await firstMatch;
    await route.fulfill({ json: { provider: 'openlibrary', id: 'OL1W', edition_id: 'OL2M', title: 'Looked-up title', author: '', description: 'Work synopsis from Open Library.', isbn10: '0765391198', isbn13: '9780765391193', cover_id: 42 } });
  });
  await page.route('**/api/v1/metadata/covers/42', route => route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(cover, 'base64') }));
  let largeCoverRequests = 0;
  await page.route('**/api/v1/metadata/covers/42?prefer_large=true', route => {
    largeCoverRequests++;
    return route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(largeCover, 'base64') });
  });
  await page.route('**/api/v1/documents/*', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const { match, ...edits } = route.request().postDataJSON();
    if (!match) return route.fallback();
    // Let the real server save selected fields and the cover without calling the live provider.
    expect(match).toEqual({ provider: 'openlibrary', work_id: 'OL1W', edition_id: 'OL2M' });
    const response = await route.fetch({ postData: edits });
    return route.fulfill({ response });
  });
  const toolbar = page.getByRole('group', { name: 'Book actions' });
  const back = page.getByRole('main').getByRole('link', { name: 'Library', exact: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const [backBox, actionsBox] = await Promise.all([back.boundingBox(), toolbar.boundingBox()]);
    expect(Math.abs(actionsBox!.y - backBox!.y)).toBeLessThanOrEqual(1);
    expect(actionsBox!.x).toBeGreaterThan(backBox!.x + backBox!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await expect(edit).toBeHidden();
  await expect(remove).toBeHidden();
  await more.click();
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
  const identify = page.getByRole('button', { name: 'Identify', exact: true });
  await more.click();
  await identify.click();
  await expect(dialog).toHaveAccessibleName('Identify Book');
  await expect(dialog.getByRole('heading', { name: 'Identify Book' })).toBeFocused();
  await page.keyboard.press('Tab');
  const closeDialog = dialog.getByRole('button', { name: 'Close Dialog' });
  await expect(closeDialog).toBeFocused();
  expect(await closeDialog.evaluate(button => button.matches(':focus-visible'))).toBe(true);
  const sheet = (await dialog.boundingBox())!;
  expect(sheet.y).toBeGreaterThan(100);
  expect(sheet.y + sheet.height).toBeCloseTo(844);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(more).toBeFocused();
  const openMatch = async () => {
    await more.click();
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
    await expect(dialog.getByRole('button', { name: 'Link Book', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('searchbox')).toHaveCount(0);
    await expect(preview.locator('[class*="matchLoadingCover"]')).toBeVisible();
    await dialog.getByRole('button', { name: 'Back to Results' }).click();
    const result = dialog.getByRole('button', { name: /Looked-up title/ });
    await expect(result).toBeFocused();
    await result.click();
    await expect(preview.getByRole('status')).toHaveText('Loading match preview…');
  } finally { releaseMatch!(); }
  await opening;
  await dialog.getByRole('button', { name: 'Back to Results' }).click();
  await expect(dialog.getByRole('button', { name: /Looked-up title/ })).toBeFocused();
  await dialog.getByRole('button', { name: /Looked-up title/ }).click();
  await expect(dialog.getByText('Work synopsis from Open Library.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Synopsis', exact: true })).toHaveCount(0);
  const coverChoice = dialog.getByRole('button', { name: 'Cover', exact: true });
  await expect(coverChoice).toHaveAttribute('aria-pressed', 'true');
  await coverChoice.click();
  await expect(coverChoice).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: 'Title', exact: true }).click();
  const isbn10Choice = dialog.getByRole('button', { name: 'ISBN-10', exact: true });
  const isbnChoice = dialog.getByRole('button', { name: 'ISBN-13', exact: true });
  await expect(isbn10Choice).toHaveAttribute('aria-pressed', 'true');
  await expect(isbnChoice).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Link and Apply 3 Changes', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Disposable editor book', exact: true })).toBeVisible();
  await openMatch();
  const image = dialog.getByRole('img', { name: 'Cover for Looked-up title' });
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(160);
  await expect(dialog.getByRole('button', { name: 'Author', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const synopsis = dialog.getByRole('button', { name: 'Synopsis', exact: true });
  await expect(synopsis).toHaveAttribute('aria-pressed', 'false');
  await synopsis.focus();
  await page.keyboard.press('Space');
  await expect(synopsis).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Link and Apply 4 Changes', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await dialog.screenshot({ path: testInfo.outputPath('identify-match-390.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await dialog.screenshot({ path: testInfo.outputPath('identify-match-desktop.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: 'Title', exact: true }).click();
  await isbnChoice.click();
  await expect(isbnChoice).toHaveAttribute('aria-pressed', 'false');
  await expect(dialog.getByRole('button', { name: 'Link and Apply 4 Changes', exact: true })).toBeEnabled();
  await isbnChoice.click();
  await expect(coverChoice).toHaveAttribute('aria-pressed', 'true');
  const largeCoverRequestsBeforeApply = largeCoverRequests;
  const saved = page.waitForRequest(req => req.method() === 'PATCH' && req.url().includes('/api/v1/documents/'));
  await dialog.getByRole('button', { name: 'Link and Apply 5 Changes', exact: true }).click();
  const body = (await saved).postDataJSON();
  expect(body.cover_base64).toBe(largeCover);
  expect(largeCoverRequests).toBe(largeCoverRequestsBeforeApply);
  expect(body).not.toHaveProperty('author');
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
  await more.click();
  await remove.click();
  await expect(dialog.getByText(/for everyone/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(appliedTitle).toBeVisible();
  await more.click();
  await remove.click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(`${server.origin}/library`);
  await expect(appliedTitle).toHaveCount(0);
});

test('Hardcover reuses cover bytes for preview and save, and still links when artwork fails', async ({ page, server }) => {
  await register(page, server.origin, 'hardcover-catalog-reader');
  const originalDocument = await (await page.request.get(`${server.origin}/api/v1/documents/book_001`)).json();
  const work = { provider: 'hardcover', id: '42', title: 'Hardcover Title', author: 'Verified Author', description: 'Catalog synopsis', cover_id: 42 };
  const edition = { ...work, edition_id: '91', isbn13: '9780765391193' };
  const cover = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 60; canvas.height = 90;
    return canvas.toDataURL('image/jpeg').split(',')[1]!;
  });
  let coverRequests = 0;
  let coverUnavailable = false;
  await page.route(/\/api\/v1\/metadata\/covers\/42(?:\?|$)/, route => {
    coverRequests++;
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('provider')).toBe('hardcover');
    expect(query.has('prefer_large')).toBe(false);
    expect(route.request().headers()['x-antholume-account']).toBeTruthy();
    if (coverUnavailable) return route.fulfill({ status: 503 });
    return route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(cover, 'base64') });
  });
  const confirmed: unknown[] = [];
  await page.route('**/api/v1/metadata/search?*', route => {
    const q = new URL(route.request().url()).searchParams.get('q');
    expect(['Verified Author', '978-0765391193']).toContain(q);
    return route.fulfill({ json: [q === 'Verified Author' ? work : edition] });
  });
  await page.route('**/api/v1/metadata/match?*', route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('provider')).toBe('hardcover');
    expect(url.searchParams.get('work_id')).toBe('42');
    if (url.searchParams.has('edition_id')) {
      expect(url.searchParams.get('edition_id')).toBe('91');
      expect(url.searchParams.get('isbn')).toBe('9780765391193');
      return route.fulfill({ json: edition });
    }
    return route.fulfill({ json: work });
  });
  let current = { ...originalDocument, cover_available: true };
  await page.route('**/api/v1/documents/book_001', route => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      confirmed.push(body);
      current = { ...current, matches: [{ provider: 'hardcover', work_id: '42' }] };
      if ('title' in body) current.title = body.title;
      if ('isbn13' in body) current.isbn13 = body.isbn13;
    }
    return route.fulfill({ json: current });
  });
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Identify Book' });
  const preview = async (query: string, expectCover = true) => {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Identify', exact: true }).click();
    await dialog.getByRole('searchbox').fill(query);
    await dialog.getByRole('button', { name: 'Search', exact: true }).click();
    const result = dialog.getByRole('button', { name: /Hardcover Title.*Verified Author/ });
    const thumbnail = result.locator('img');
    if (expectCover) await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(60);
    await result.click();
    await expect(dialog.getByRole('region', { name: 'Match preview' })).toBeVisible();
    await expect(dialog.getByText('Catalog synopsis')).toBeVisible();
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    await expect(dialog.getByText('Link this book with or without applying metadata changes.')).toHaveCount(0);
    await expect(dialog.getByText('No edition verified.', { exact: false })).toHaveCount(0);
    await expect(dialog.getByText(/^(Book|Edition) Cover$/)).toHaveCount(0);
    const choice = dialog.getByRole('button', { name: 'Cover', exact: true });
    if (expectCover) {
      await expect(choice).toBeEnabled();
      await expect(choice).toHaveAttribute('aria-pressed', 'false');
    } else {
      await expect(choice).toHaveCount(0);
    }
  };
  await preview('Verified Author');
  expect(coverRequests).toBe(1);
  expect(confirmed).toEqual([]);
  const link = dialog.getByRole('button', { name: 'Link Book', exact: true });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await link.click({ trial: true });
  }
  await link.click();
  await expect(dialog).toHaveCount(0);
  expect(confirmed).toEqual([{ match: { provider: 'hardcover', work_id: '42' } }]);
  await expect(page.getByRole('heading', { name: 'Public book 01', exact: true })).toBeVisible();

  await preview('978-0765391193');
  await expect(dialog.getByText(/ISBN match/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Title', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cover', exact: true }).click();
  await dialog.getByRole('button', { name: 'Link and Apply 3 Changes' }).click();
  await expect(dialog).toHaveCount(0);
  expect(coverRequests).toBe(2);
  expect(confirmed[1]).toEqual({ match: { provider: 'hardcover', work_id: '42', edition_id: '91', isbn: '9780765391193' }, isbn13: edition.isbn13, title: work.title, cover_base64: cover });
  await expect(page.getByRole('heading', { name: work.title, exact: true })).toBeVisible();

  coverUnavailable = true;
  current = { ...current, cover_available: false };
  await preview('Verified Author', false);
  await dialog.getByRole('button', { name: 'Synopsis', exact: true }).click();
  await dialog.getByRole('button', { name: 'Link and Apply 1 Change', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(coverRequests).toBe(3);
  expect(confirmed[2]).toEqual({ match: { provider: 'hardcover', work_id: '42' }, description: work.description });
});
