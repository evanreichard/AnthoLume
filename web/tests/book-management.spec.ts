import { readFile } from 'node:fs/promises';
import { epub, expect, register, test } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('book details show file information and download the original EPUB', async ({ page, server }) => {
  await register(page, server.origin, 'book-info');
  const original = await epub('Downloadable edition');
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();
  await page.getByLabel('Choose EPUB to upload').setInputFiles({ name: 'original.epub', mimeType: 'application/epub+zip', buffer: original });
  await page.locator('[data-snackbar]').getByRole('button', { name: 'Open', exact: true }).click();
  await page.setViewportSize({ width: 320, height: 844 });
  const details = page.getByRole('region', { name: 'Book details' });
  const author = details.getByRole('term').filter({ hasText: /^Author$/ });
  const synopsis = details.getByRole('term').filter({ hasText: /^Synopsis$/ });
  for (const property of ['font-size', 'font-weight', 'color']) {
    await expect(synopsis).toHaveCSS(property, await author.evaluate((node, prop) => getComputedStyle(node).getPropertyValue(prop), property));
  }
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

test('Identify centers empty and retryable failure states within the review body', async ({ page, server }) => {
  await register(page, server.origin, 'identify-empty');
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();
  await page.getByLabel('Choose EPUB to upload').setInputFiles({ name: 'empty.epub', mimeType: 'application/epub+zip', buffer: await epub('Unknown edition') });
  await page.locator('[data-snackbar]').getByRole('button', { name: 'Open', exact: true }).click();
  let fail = true;
  await page.route('**/api/v1/metadata/search?*', route => fail ? route.abort() : route.fulfill({ json: [] }));
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Identify', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review Metadata' });
  for (const width of [390, 900]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(dialog.getByRole('alert')).toBeVisible();
    const offsets = await dialog.getByRole('alert').evaluate(node => {
      const group = node.parentElement!, body = group.parentElement!.parentElement!;
      const g = group.getBoundingClientRect(), b = body.getBoundingClientRect();
      return [Math.abs(g.x + g.width / 2 - b.x - b.width / 2), Math.abs(g.y + g.height / 2 - b.y - b.height / 2)];
    });
    expect(Math.max(...offsets)).toBeLessThan(2);
  }
  fail = false;
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  const hint = dialog.getByText('Choose a suggested match or search by title, author, or ISBN.');
  await expect(hint).toBeVisible();
  const offset = await hint.evaluate(node => {
    const g = node.getBoundingClientRect(), b = node.parentElement!.parentElement!.getBoundingClientRect();
    return Math.max(Math.abs(g.x + g.width / 2 - b.x - b.width / 2), Math.abs(g.y + g.height / 2 - b.y - b.height / 2));
  });
  expect(offset).toBeLessThan(2);
});

test('book editor previews metadata without saving, saves cover and fields, and confirms shared deletion', async ({ page, server }, testInfo) => {
  await register(page, server.origin, 'book-editor');
  await page.getByRole('button', { name: 'Add Book', exact: true }).click();
  await page.getByLabel('Choose EPUB to upload').setInputFiles({ name: 'editor.epub', mimeType: 'application/epub+zip', buffer: await epub('Disposable editor book') });
  await page.locator('[data-snackbar]').getByRole('button', { name: 'Open', exact: true }).click();
  const more = page.getByRole('button', { name: 'More', exact: true });
  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  const remove = page.getByRole('button', { name: 'Delete', exact: true });
  const jpeg = (width: number) => page.evaluate(width => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = width * 1.5;
    return canvas.toDataURL('image/jpeg').split(',')[1]!;
  }, width);
  const largeCover = await jpeg(160);
  const longTitle = 'A collection of novels with a very long title that does not fit on one line on a mobile screen';
  let releaseSearch: () => void;
  const firstSearch = new Promise<void>(resolve => { releaseSearch = resolve; });
  const suggestion = { provider: 'openlibrary', id: 'OL1W', title: 'Looked-up title', author: 'New author', year: 2022, edition_id: 'OL2M', cover_id: 42 };
  const alternate = { provider: 'openlibrary', id: 'OL4W', title: 'Manual alternate', author: 'Other author' };
  const searches: string[] = [];
  await page.route('**/api/v1/metadata/search?*', async route => {
    const q = new URL(route.request().url()).searchParams.get('q')!;
    searches.push(q);
    if (q === 'no catalog result') return route.fulfill({ json: [] });
    if (q === 'manual alternate') return route.fulfill({ json: [alternate] });
    expect(q).toMatch(/^(Disposable editor book|Looked-up title)( Author to preserve)?$|^9780765391193$/);
    await firstSearch;
    return route.fulfill({ json: [suggestion, { provider: 'openlibrary', id: 'OL3W', title: longTitle, author: 'Another author', year: 2025 }] });
  });
  let releaseMatch: () => void;
  const firstMatch = new Promise<void>(resolve => { releaseMatch = resolve; });
  const previews: string[] = [];
  await page.route('**/api/v1/metadata/match?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('provider')).toBe('openlibrary');
    previews.push(params.get('work_id')!);
    if (params.get('work_id') === alternate.id) return route.fulfill({ json: { ...alternate, description: 'Verified alternate synopsis.' } });
    expect(params.get('work_id')).toBe(suggestion.id);
    expect(params.get('edition_id')).toBe(suggestion.edition_id);
    await firstMatch;
    await route.fulfill({ json: { ...suggestion, author: '', description: 'Work synopsis from Open Library.', isbn10: '0765391198', isbn13: '9780765391193' } });
  });
  let largeCoverRequests = 0;
  await page.route(/\/api\/v1\/metadata\/covers\/42(?:\?|$)/, route => {
    expect(new URL(route.request().url()).searchParams.get('prefer_large')).toBe('true');
    largeCoverRequests++;
    return route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(largeCover, 'base64') });
  });
  const confirmed: unknown[] = [];
  await page.route('**/api/v1/documents/*', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const { match, ...edits } = route.request().postDataJSON();
    if (!match) return route.fallback();
    // Let the real server save selected fields and the cover without calling the live provider.
    expect(match).toEqual({ provider: 'openlibrary', work_id: 'OL1W', edition_id: 'OL2M' });
    confirmed.push({ match, ...edits });
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
  await expect(dialog).toHaveAccessibleName('Review Metadata');
  await expect(dialog.getByRole('heading', { name: 'Review Metadata' })).toBeFocused();
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
  const pick = dialog.getByRole('button', { name: /^Choose Match/i });
  const results = dialog.getByRole('group', { name: 'Book Matches', exact: true });
  const search = results.getByRole('searchbox', { name: /Title, Author, or ISBN/i });
  const restore = results.getByRole('button', { name: 'Suggested Matches', exact: true });
  const primaryAction = dialog.getByRole('button', { name: /^Link(?: Book| (?:and|&) Apply)/i });
  const openMatch = async () => {
    await more.click();
    await identify.click();
  };
  await openMatch();
  try {
    await expect(dialog.getByRole('status').filter({ hasText: /Finding suggested matches/i })).toBeVisible();
    await expect(primaryAction).toBeDisabled();
    await dialog.screenshot({ path: testInfo.outputPath('identify-searching-390.png'), animations: 'disabled' });
  } finally { releaseSearch!(); }
  try {
    await expect.poll(() => previews).toContain(suggestion.id);
    await expect(dialog.getByRole('status').filter({ hasText: /Loading.*preview/i })).toBeVisible();
    await expect(dialog.locator('[class*="matchLoadingCover"]')).toBeVisible();
    await expect(primaryAction).toBeDisabled();
    await expect(dialog.getByRole('searchbox')).toHaveCount(0);
  } finally { releaseMatch!(); }
  expect(searches[0]).toBe('Disposable editor book Author to preserve');
  await expect(pick).toContainText('Looked-up title');
  await expect(dialog.getByRole('button', { name: /Open Library/i })).toBeDisabled();
  await pick.click();
  await expect(search).toBeVisible();
  await expect(search).not.toBeFocused();
  await search.focus();
  await page.setViewportSize({ width: 390, height: 520 });
  const anchor = (await pick.boundingBox())!;
  const focusedPanel = (await results.boundingBox())!;
  const gap = focusedPanel.y - (anchor.y + anchor.height);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(12);
  await expect(search).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  const longResult = results.getByRole('button', { name: new RegExp(longTitle) });
  await expect(longResult).toBeVisible();
  await expect(longResult).toContainText('Another author');
  await dialog.screenshot({ path: testInfo.outputPath('identify-results-390.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(results).toBeHidden();
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
  await expect(dialog.getByRole('button', { name: /Link (?:and|&) Apply 3 Changes/i })).toBeEnabled();
  await pick.click();
  const verified = [...previews];
  await search.fill('no catalog result');
  await search.press('Enter');
  await expect(results.getByText(/No matches/i)).toBeVisible();
  await expect(pick).toContainText(suggestion.title);
  await expect(coverChoice).toHaveAttribute('aria-pressed', 'false');
  await expect(dialog.getByRole('button', { name: 'Title', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await search.fill('manual alternate');
  await results.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(results.getByRole('button', { name: /Manual alternate/ })).toBeVisible();
  expect(previews).toEqual(verified);
  await expect(pick).toContainText(suggestion.title);
  await results.getByRole('button', { name: /Manual alternate/ }).click();
  await expect(results).toBeHidden();
  await expect(dialog.getByText('Verified alternate synopsis.')).toBeVisible();
  expect(previews.at(-1)).toBe(alternate.id);
  await pick.click();
  await restore.click();
  await expect(results.getByRole('button', { name: new RegExp(longTitle) })).toBeVisible();
  await expect(pick).toContainText(suggestion.title);
  await page.keyboard.press('Escape');
  await expect(coverChoice).toHaveAttribute('aria-pressed', 'false');
  await expect(dialog.getByRole('button', { name: 'Title', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(confirmed).toEqual([]);
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
  await expect(dialog.getByRole('button', { name: /Link (?:and|&) Apply 4 Changes/i })).toBeEnabled();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await dialog.screenshot({ path: testInfo.outputPath('identify-match-390.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await dialog.screenshot({ path: testInfo.outputPath('identify-match-desktop.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: 'Title', exact: true }).click();
  await isbnChoice.click();
  await expect(isbnChoice).toHaveAttribute('aria-pressed', 'false');
  await expect(dialog.getByRole('button', { name: /Link (?:and|&) Apply 4 Changes/i })).toBeEnabled();
  await isbnChoice.click();
  await expect(coverChoice).toHaveAttribute('aria-pressed', 'true');
  const largeCoverRequestsBeforeApply = largeCoverRequests;
  const saved = page.waitForRequest(req => req.method() === 'PATCH' && req.url().includes('/api/v1/documents/'));
  await dialog.getByRole('button', { name: /Link (?:and|&) Apply 5 Changes/i }).click();
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
    expect(['Public book 01 Synthetic Author', 'Hardcover Title Synthetic Author', '9780765391193']).toContain(q);
    return route.fulfill({ json: [q === '9780765391193' ? edition : work] });
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
  const dialog = page.getByRole('dialog', { name: 'Review Metadata' });
  const preview = async (query?: string, expectCover = true) => {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Identify', exact: true }).click();
    const pick = dialog.getByRole('button', { name: /^Choose Match/i });
    await expect(pick).toContainText(work.title);
    await expect(dialog.getByRole('button', { name: /Hardcover/i })).toBeDisabled();
    if (query) {
      await pick.click();
      const results = dialog.getByRole('group', { name: 'Book Matches', exact: true });
      await results.getByRole('searchbox', { name: /Title, Author, or ISBN/i }).fill(query);
      await results.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(results.getByRole('button', { name: 'Suggested Matches', exact: true })).toBeVisible();
      await results.getByRole('button', { name: /Hardcover Title.*Verified Author/ }).click();
      await expect(results).toBeHidden();
    }
    await expect(dialog.getByRole('region', { name: 'Match Preview', exact: true })).toBeVisible();
    await expect(dialog.getByText('Catalog synopsis')).toBeVisible();
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    await expect(dialog.getByText('Link this book with or without applying metadata changes.')).toHaveCount(0);
    await expect(dialog.getByText('No edition verified.', { exact: false })).toHaveCount(0);
    await expect(dialog.getByText(/^(Book|Edition) Cover$/)).toHaveCount(0);
    const choice = dialog.getByRole('button', { name: 'Cover', exact: true });
    if (expectCover) {
      await expect(choice).toBeEnabled();
      await expect.poll(() => choice.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(60);
      await expect(choice).toHaveAttribute('aria-pressed', 'false');
    } else {
      await expect(choice).toHaveCount(0);
    }
  };
  await preview();
  expect(coverRequests).toBe(1);
  expect(confirmed).toEqual([]);
  const link = dialog.getByRole('button', { name: /^(Link|Link Book)$/ });
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
  await dialog.getByRole('button', { name: /(?:Link (?:and|&) )?Apply 3 Changes/i }).click();
  await expect(dialog).toHaveCount(0);
  expect(coverRequests).toBe(2);
  expect(confirmed[1]).toEqual({ match: { provider: 'hardcover', work_id: '42', edition_id: '91', isbn: '9780765391193' }, isbn13: edition.isbn13, title: work.title, cover_base64: cover });
  await expect(page.getByRole('heading', { name: work.title, exact: true })).toBeVisible();

  coverUnavailable = true;
  current = { ...current, cover_available: false };
  const missingArtwork = page.waitForResponse(response => response.url().includes('/metadata/covers/42') && response.status() === 503);
  await preview(undefined, false);
  await missingArtwork;
  await dialog.getByRole('button', { name: 'Synopsis', exact: true }).click();
  await dialog.getByRole('button', { name: /(?:Link (?:and|&) )?Apply 1 Change$/i }).click();
  await expect(dialog).toHaveCount(0);
  expect(coverRequests).toBe(3);
  expect(confirmed[2]).toEqual({ match: { provider: 'hardcover', work_id: '42', edition_id: '91', isbn: '9780765391193' }, description: work.description });
});
