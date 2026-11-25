import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { components } from '../src/api/schema.gen';
import { epub, expect, mockMatcherLookup, register, test, type LookupOutcome } from './fixtures';

type Provider = components['schemas']['MetadataProvider'];
const viewportWidths = [320, 390, 1280];
const isbn13 = '9780765391193';
const isbn10 = '0765391198';
const bookID = (page: Page) => new URL(page.url()).searchParams.get('id');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function bookAction(page: Page, name: string) {
  await button(page, 'More').click();
  await button(page, name).click();
  return page.getByRole('dialog');
}

async function uploadBook(page: Page, bytes: Buffer) {
  await button(page, 'Add Book').click();
  await page.getByLabel('Choose EPUB to upload').setInputFiles({ name: 'book.epub', mimeType: 'application/epub+zip', buffer: bytes });
  await page.locator('[data-snackbar]').getByRole('button', { name: 'Open', exact: true }).click();
}

function jpeg(page: Page, width = 60) {
  return page.evaluate(width => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = width * 1.5;
    return canvas.toDataURL('image/jpeg').split(',')[1]!;
  }, width);
}

async function publicBook(page: Page, origin: string) {
  const endpoint = `${origin}/api/v1/documents/book_001`;
  const response = await page.request.get(endpoint);
  expect(response.ok()).toBe(true);
  const original: components['schemas']['Document'] = await response.json();
  return { endpoint, original };
}

async function mockAutomaticLookup(page: Page, provider: Provider, id: string | null, outcome: () => LookupOutcome | Promise<LookupOutcome>) {
  await page.route('**/api/v1/metadata/providers', route => route.fulfill({ json: { selected: provider, effective: provider, hardcover_available: true } }));
  await mockMatcherLookup(page, (_, body) => { expect(body).toEqual({ provider, document_ids: [id] }); return outcome(); });
}

test.use({ serviceWorkers: 'block' });

test('book details show file information and download the original EPUB', async ({ page, server }) => {
  await register(page, server.origin, 'book-info');
  const original = await epub('Downloadable edition');
  await uploadBook(page, original);
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
  await uploadBook(page, await epub('Unknown edition'));
  let fail = true;
  await mockAutomaticLookup(page, 'openlibrary', bookID(page), () => fail ? { error: 'rate_limited' } : { candidates: [] });
  const dialog = await bookAction(page, 'Identify');
  const assertCentered = async (notice: ReturnType<typeof dialog.getByText>) => {
    await expect(notice).toBeVisible();
    const offset = await notice.evaluate(node => {
      const state = node.closest('[class*="centeredState"]')!;
      const content = (state.firstElementChild ?? node).getBoundingClientRect();
      const body = state.parentElement!.getBoundingClientRect();
      return Math.max(Math.abs(content.x + content.width / 2 - body.x - body.width / 2), Math.abs(content.y + content.height / 2 - body.y - body.height / 2));
    });
    expect(offset).toBeLessThan(2);
  };
  for (const width of [390, 900]) {
    await page.setViewportSize({ width, height: 844 });
    await assertCentered(dialog.getByRole('alert'));
  }
  fail = false;
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await assertCentered(dialog.getByText('Choose a suggested match or search by title, author, or ISBN.'));
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button(page, 'More')).toBeFocused();
});

test('book editor previews metadata without saving, saves cover and fields, and confirms shared deletion', async ({ page, server }) => {
  await register(page, server.origin, 'book-editor');
  const title = 'Disposable editor book', author = 'Author to preserve', description = 'Work synopsis from Open Library.';
  await uploadBook(page, await epub(title));
  const id = bookID(page);
  const more = button(page, 'More');
  const largeCover = await jpeg(page, 160);
  const longTitle = 'A collection of novels with a very long title that does not fit on one line on a mobile screen';
  let releaseLookup!: () => void, releasePreview!: () => void;
  const lookupGate = new Promise<void>(resolve => { releaseLookup = resolve; });
  const previewGate = new Promise<void>(resolve => { releasePreview = resolve; });
  const suggestion = { provider: 'openlibrary', id: 'OL1W', title: 'Looked-up title', author: 'New author', year: 2022, edition_id: 'OL2M', cover_id: 42 };
  const alternate = { provider: 'openlibrary', id: 'OL4W', title: 'Manual alternate', author: 'Other author' };
  const match = { provider: 'openlibrary', work_id: suggestion.id, edition_id: suggestion.edition_id, isbn: isbn13 };
  await mockAutomaticLookup(page, 'openlibrary', id, async () => {
    await lookupGate;
    return { candidates: [
      { work_id: suggestion.id, title: suggestion.title, author: suggestion.author, url: 'https://openlibrary.org/works/OL1W', edition_id: match.edition_id, isbn: match.isbn },
      { work_id: 'OL3W', title: longTitle, author: 'Another author', url: 'https://openlibrary.org/works/OL3W' },
    ] };
  });
  await page.route('**/api/v1/metadata/search?*', route => {
    const q = new URL(route.request().url()).searchParams.get('q');
    expect(['no catalog result', 'manual alternate']).toContain(q);
    return route.fulfill({ json: q === 'manual alternate' ? [alternate] : [] });
  });
  const alternateMatch = { provider: alternate.provider, work_id: alternate.id };
  const previews: object[] = [];
  await page.route('**/api/v1/metadata/match?*', async route => {
    const params = Object.fromEntries(new URL(route.request().url()).searchParams);
    previews.push(params);
    if (params.work_id === alternate.id) {
      expect(params).toEqual(alternateMatch);
      return route.fulfill({ json: { ...alternate, description: 'Verified alternate synopsis.' } });
    }
    expect(params).toEqual(match);
    await previewGate;
    return route.fulfill({ json: { ...suggestion, author: '', description, isbn10, isbn13 } });
  });
  let largeCoverRequests = 0;
  await page.route(/\/api\/v1\/metadata\/covers\/42(?:\?|$)/, route => {
    expect(new URL(route.request().url()).searchParams.get('prefer_large')).toBe('true');
    largeCoverRequests++;
    return route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(largeCover, 'base64') });
  });
  const writes: unknown[] = [];
  await page.route(`${server.origin}/api/v1/documents/${encodeURIComponent(id!)}`, async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const { match, ...edits } = route.request().postDataJSON();
    writes.push({ match, ...edits });
    // Test the real document update without resolving the synthetic provider link.
    return route.fulfill({ response: await route.fetch({ postData: edits }) });
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
  await expect(button(page, 'Edit')).toBeHidden();
  await expect(button(page, 'Delete')).toBeHidden();
  const dialog = await bookAction(page, 'Edit');
  await expect(dialog).toHaveAccessibleName('Edit book');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const editor = (await dialog.boundingBox())!;
    expect(editor.width).toBeLessThanOrEqual(width - 24);
    expect(Math.abs(editor.y - (844 - editor.y - editor.height))).toBeLessThanOrEqual(1);
    expect(editor.y).toBeGreaterThanOrEqual(23);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByLabel('Author', { exact: true }).fill(author);
  await dialog.getByLabel('ISBN-13', { exact: true }).fill(isbn13);
  await dialog.getByLabel('Synopsis', { exact: true }).fill('Original synopsis.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Original synopsis.', { exact: true })).toBeVisible();
  writes.length = 0;
  const pick = dialog.getByRole('button', { name: /^Choose Match/i });
  const results = dialog.getByRole('group', { name: 'Book Matches', exact: true });
  const search = results.getByRole('searchbox', { name: /Title, Author, or ISBN/i });
  const restore = results.getByRole('button', { name: 'Suggested Matches', exact: true });
  const primaryAction = dialog.getByRole('button', { name: /^Link(?: Book| (?:and|&) Apply)/i });
  await bookAction(page, 'Identify');
  try {
    const heading = dialog.getByRole('heading', { name: 'Review Metadata' });
    await expect(heading).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.locator('button:focus-visible')).toHaveAccessibleName('Close Dialog');
    const sheet = (await dialog.boundingBox())!;
    expect(sheet.y).toBeGreaterThan(100);
    expect(sheet.y + sheet.height).toBeCloseTo(844);
    await expect(dialog.getByRole('status').filter({ hasText: /Finding suggested matches/i })).toBeVisible();
    await expect(primaryAction).toBeDisabled();
  } finally { releaseLookup(); }
  try {
    await expect(dialog.getByRole('status').filter({ hasText: /Loading.*preview/i })).toBeVisible();
    await expect(dialog.locator('[class*="matchLoadingCover"]')).toBeVisible();
    await expect(primaryAction).toBeDisabled();
    await expect(search).toBeHidden();
  } finally { releasePreview(); }
  await expect(pick).toContainText('Looked-up title');
  await expect(dialog.getByRole('button', { name: /Open Library/i })).toBeDisabled();
  await pick.click();
  await expect(search).toBeVisible();
  await expect(search).not.toBeFocused();
  await search.focus();
  await page.setViewportSize({ width: 390, height: 520 });
  const anchor = (await pick.boundingBox())!;
  const gap = (await results.boundingBox())!.y - anchor.y - anchor.height;
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThan(12);
  await expect(search).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  const longResult = results.getByRole('button', { name: new RegExp(`${longTitle} Another author`) });
  await expect(longResult).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(results).toBeHidden();
  await expect(dialog.getByText(description, { exact: true })).toBeVisible();
  const field = (name: string) => dialog.getByRole('button', { name, exact: true });
  const assertSelected = async (name: string, selected: boolean) => expect(field(name)).toHaveAttribute('aria-pressed', String(selected));
  await assertSelected('Cover', true);
  await assertSelected('ISBN-10', true);
  await assertSelected('ISBN-13', false);
  await field('Cover').click();
  await field('Title').click();
  await pick.click();
  const manual = results.getByRole('button', { name: /Manual alternate/ });
  for (const query of ['no catalog result', 'manual alternate']) {
    await search.fill(query);
    if (query === 'no catalog result') {
      await search.press('Enter');
      await expect(results.getByText(/No matches/i)).toBeVisible();
    } else {
      await results.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(manual).toBeVisible();
    }
    expect(previews).toEqual([match]);
    await expect(pick).toContainText(suggestion.title);
    await assertSelected('Cover', false);
    await assertSelected('Title', true);
  }
  await manual.click();
  await expect(results).toBeHidden();
  await expect(dialog.getByText('Verified alternate synopsis.')).toBeVisible();
  expect(previews).toEqual([match, alternateMatch]);
  await pick.click();
  await restore.click();
  await expect(longResult).toBeVisible();
  await expect(pick).toContainText(suggestion.title);
  await page.keyboard.press('Escape');
  await assertSelected('Cover', false);
  await assertSelected('Title', true);
  await field('Cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(more).toBeFocused();
  expect(writes).toEqual([]);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();

  await bookAction(page, 'Identify');
  await expect.poll(() => field('Cover').locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(160);
  await assertSelected('Author', false);
  await assertSelected('Synopsis', false);
  await field('Synopsis').press('Space');
  await field('Title').click();
  await field('ISBN-13').click();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  const coversBeforeSave = largeCoverRequests;
  await field('Link and Apply 5 Changes').click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toEqual([{ match, cover_base64: largeCover, title: suggestion.title, description, isbn10, isbn13 }]);
  expect(largeCoverRequests).toBe(coversBeforeSave);
  const appliedTitle = page.getByRole('heading', { name: suggestion.title, exact: true });
  await expect(appliedTitle).toBeVisible();
  const details = page.getByRole('region', { name: 'Book details' });
  for (const value of [description, author, isbn13]) await expect(details.getByText(value, { exact: true })).toBeVisible();

  await bookAction(page, 'Delete');
  await expect(dialog.getByText(/for everyone/)).toBeVisible();
  await field('Cancel').click();
  await expect(appliedTitle).toBeVisible();
  await bookAction(page, 'Delete');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page).toHaveURL(`${server.origin}/library`);
  await expect(appliedTitle).toHaveCount(0);
});

test('Book Details reviews exact confirmed sources without searching or relinking', async ({ page, server }) => {
  await register(page, server.origin, 'confirmed-source-reader');
  const { endpoint, original } = await publicBook(page, server.origin);
  const provider = await (await page.request.get(`${server.origin}/api/v1/metadata/providers`)).json();
  expect(provider.effective).toBe('openlibrary');

  const savedLinks: NonNullable<typeof original.matches> = [{ provider: 'openlibrary', work_id: 'OL101W' }, { provider: 'hardcover', work_id: '42' }];
  const linked_source = savedLinks[1], description = 'Synopsis from the saved Hardcover record.', localSynopsis = 'Original synopsis';
  const catalog = { provider: linked_source.provider, id: linked_source.work_id, title: 'Catalog title', author: 'Catalog author', description, cover_id: 42 };
  let current: typeof original = { ...original, description: localSynopsis, cover_available: true, reading_stats: { reading_seconds: 0, words_per_minute: 0, word_count: 161098 }, matches: [] };
  const cover = await jpeg(page);
  let failPreview = true;
  let previews = 0;
  const writes: unknown[] = [];
  await page.route(endpoint, async route => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      writes.push(body);
      current = { ...current, description: body.description };
    }
    await route.fulfill({ json: current });
  });
  await page.route(`${endpoint}/matches/${linked_source.provider}?work_id=${linked_source.work_id}`, route => {
    expect(route.request().method()).toBe('GET');
    previews++;
    return failPreview ? route.fulfill({ status: 503 }) : route.fulfill({ json: catalog });
  });
  await page.route(/\/api\/v1\/metadata\/covers\/42(?:\?|$)/, route => {
    const params = new URL(route.request().url()).searchParams;
    expect([params.get('provider'), params.get('document_id'), params.get('work_id')]).toEqual(['hardcover', 'book_001', '42']);
    return route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(cover, 'base64') });
  });
  const discoveries: string[] = [];
  await page.route(/\/api\/v1\/metadata\/(search|lookups|match)(?:\?|$)/, route => {
    discoveries.push(route.request().url());
    return route.abort();
  });

  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  const bookURL = page.url();
  const details = page.getByRole('region', { name: 'Book details' });
  const sourcesLabel = details.getByText('Sources', { exact: true });
  await expect(details.getByText(localSynopsis, { exact: true })).toBeVisible();
  await expect(sourcesLabel).toHaveCount(0);

  current = { ...current, matches: savedLinks };
  await page.goto(bookURL);
  await expect(sourcesLabel).toBeVisible();
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 844 });
    const length = (await details.getByText('Length', { exact: true }).boundingBox())!;
    const sources = (await sourcesLabel.boundingBox())!;
    expect(sources.y).toBeCloseTo(length.y, 0);
    expect(sources.x).toBeGreaterThan(length.x);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const hardcover = details.getByRole('button', { name: 'Review Hardcover metadata: 42', exact: true });
  const openLibrary = details.getByRole('button', { name: 'Review Open Library metadata: OL101W', exact: true });
  for (const [pill, id] of [[hardcover, '42'], [openLibrary, 'OL101W']] as const) {
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(id);
    await expect(pill.locator('img')).toHaveCount(1);
    const box = (await pill.boundingBox())!;
    expect(box.height).toBe(24);
    expect(await pill.evaluate(button => { const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.left + r.width / 2, r.bottom + 2)); })).toBe(false);
  }

  const dialog = page.getByRole('dialog', { name: 'Review Metadata' });
  const source = dialog.getByRole('link', { name: /^View on Hardcover/i });
  expect(previews).toBe(0);
  await hardcover.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(source).toHaveAttribute('href', 'https://hardcover.app/id/book/42');
  const cancelButton = dialog.locator('footer').getByRole('button', { name: 'Cancel' });
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 844 });
    const link = (await source.boundingBox())!, cancel = (await cancelButton.boundingBox())!;
    expect(link.x).toBeGreaterThan(cancel.x + cancel.width);
    expect(link.y + link.height / 2).toBeCloseTo(cancel.y + cancel.height / 2, 0);
    expect(link.height).toBeGreaterThanOrEqual(44);
    if (width === 320) await expect(source.getByText('Hardcover', { exact: true })).toBeHidden();
    else await expect(source.getByText('Hardcover', { exact: true })).toBeVisible();
  }
  expect(previews).toBe(1);
  failPreview = false;
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByText(catalog.description, { exact: true })).toBeVisible();
  const coverChoice = dialog.getByRole('button', { name: 'Cover', exact: true });
  await expect.poll(() => coverChoice.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(60);
  await expect(coverChoice).toHaveAttribute('aria-pressed', 'false');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(hardcover).toBeFocused();
  expect(writes).toEqual([]);
  await expect(details.getByText(localSynopsis, { exact: true })).toBeVisible();

  await hardcover.click();
  const synopsis = dialog.getByRole('button', { name: 'Synopsis', exact: true });
  await expect(synopsis).toHaveAttribute('aria-pressed', 'false');
  await synopsis.click();
  await dialog.getByRole('button', { name: /^Apply 1 Change$/i }).click();
  await expect(dialog).toHaveCount(0);
  await expect(details.getByText(catalog.description, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Public book 01', exact: true })).toBeVisible();
  await expect(hardcover).toBeVisible();
  await expect(openLibrary).toBeVisible();
  expect(writes).toEqual([{ linked_source, description }]);
  expect(previews).toBe(3);
  expect(discoveries).toEqual([]);
});

test('Hardcover reuses cover bytes for preview and save, and still links when artwork fails', async ({ page, server }) => {
  await register(page, server.origin, 'hardcover-catalog-reader');
  const { endpoint, original } = await publicBook(page, server.origin);
  const linked_source = { provider: 'hardcover' as const, work_id: '42' };
  const { provider, work_id } = linked_source;
  const url = `https://hardcover.app/id/book/${work_id}`;
  const work = { provider, id: work_id, title: 'Hardcover Title', author: 'Verified Author', description: 'Catalog synopsis', cover_id: 42 };
  const edition = { ...work, edition_id: '91', isbn13 };
  const editionMatch = { ...linked_source, edition_id: edition.edition_id, isbn: isbn13 };
  const cover = await jpeg(page);
  let coverRequests = 0, coverUnavailable = false;
  await page.route(/\/api\/v1\/metadata\/covers\/42(?:\?|$)/, route => {
    coverRequests++;
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('provider')).toBe(provider);
    expect(query.has('prefer_large')).toBe(false);
    expect(route.request().headers()['x-antholume-account']).toBeTruthy();
    return coverUnavailable ? route.fulfill({ status: 503 }) : route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(cover, 'base64') });
  });
  const confirmed: unknown[] = [];
  let current = { ...original, cover_available: true };
  await mockAutomaticLookup(page, provider, original.id, () => current.matches?.length
    ? { match: { work_id, url } }
    : { candidates: [{ work_id, title: work.title, author: work.author, url }] });
  await page.route(`${endpoint}/matches/${provider}?work_id=${work_id}`, route => route.fulfill({ json: current.isbn13 ? edition : work }));
  await page.route(`**/api/v1/metadata/search?q=${isbn13}`, route => route.fulfill({ json: [edition] }));
  await page.route('**/api/v1/metadata/match?*', route => {
    const params = Object.fromEntries(new URL(route.request().url()).searchParams);
    const verified = 'edition_id' in params;
    expect(params).toEqual(verified ? editionMatch : linked_source);
    return route.fulfill({ json: verified ? edition : work });
  });
  await page.route(endpoint, route => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      confirmed.push(body);
      current = { ...current, title: body.title ?? current.title, isbn13: body.isbn13 ?? current.isbn13, matches: [linked_source] };
    }
    return route.fulfill({ json: current });
  });
  await page.getByRole('heading', { name: 'Public book 01', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Review Metadata' });
  const field = (name: string) => dialog.getByRole('button', { name, exact: true });
  const coverChoice = field('Cover');
  const assertCover = async () => {
    await expect(coverChoice).toBeEnabled();
    await expect.poll(() => coverChoice.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(60);
    await expect(coverChoice).toHaveAttribute('aria-pressed', 'false');
  };
  await bookAction(page, 'Identify');
  await assertCover();
  await expect(dialog.getByRole('button', { name: /Hardcover/i })).toBeDisabled();
  expect(coverRequests).toBe(1);
  expect(confirmed).toEqual([]);
  const link = dialog.getByRole('button', { name: /^(Link|Link Book)$/ });
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 844 });
    await link.click({ trial: true });
  }
  await link.click();
  await expect(dialog).toHaveCount(0);
  expect(confirmed).toEqual([{ match: linked_source }]);
  await expect(page.getByRole('heading', { name: 'Public book 01', exact: true })).toBeVisible();

  await bookAction(page, 'Identify');
  await dialog.getByRole('button', { name: /^Choose Match/i }).click();
  const results = dialog.getByRole('group', { name: 'Book Matches', exact: true });
  const search = results.getByRole('searchbox');
  await search.fill('978-0765391193');
  await search.press('Enter');
  await results.getByRole('button', { name: /Hardcover Title.*Verified Author/ }).click();
  await expect(results).toBeHidden();
  await expect(dialog.getByText(/ISBN match/)).toBeVisible();
  await assertCover();
  await field('Title').click();
  await coverChoice.click();
  await dialog.getByRole('button', { name: /(?:Link (?:and|&) )?Apply 3 Changes/i }).click();
  await expect(dialog).toHaveCount(0);
  expect(coverRequests).toBe(2);
  expect(confirmed[1]).toEqual({ match: editionMatch, isbn13, title: work.title, cover_base64: cover });
  await expect(page.getByRole('heading', { name: work.title, exact: true })).toBeVisible();

  coverUnavailable = true;
  current = { ...current, cover_available: false };
  const missingArtwork = page.waitForResponse(response => response.url().includes('/metadata/covers/42') && response.status() === 503);
  await bookAction(page, 'Identify');
  await missingArtwork;
  await expect(coverChoice).toHaveCount(0);
  await field('Synopsis').click();
  await dialog.getByRole('button', { name: /(?:Link (?:and|&) )?Apply 1 Change$/i }).click();
  await expect(dialog).toHaveCount(0);
  expect(coverRequests).toBe(3);
  expect(confirmed[2]).toEqual({ linked_source, description: work.description });
});
