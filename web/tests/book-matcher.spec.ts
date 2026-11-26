import { randomUUID } from 'node:crypto';
import { request, type Page } from '@playwright/test';
import type { components } from '../src/api/schema.gen';
import { expect, mockMatcherLookup, register, test } from './fixtures';

const libraryURL = '/library?q=Public+book&sort=author';
const matcherTitle = (page: Page) => page.getByRole('heading', { name: 'Book Matcher', exact: true });
const backToLibrary = (page: Page) => page.getByRole('main').getByRole('link', { name: /^(?:Back to )?Library$/i });
const providerButton = (page: Page) => page.getByRole('button', { name: /^Provider:/ });
const providerOptions = (page: Page) => page.getByRole('group', { name: 'Provider Options' });
const modeButton = (page: Page) => page.getByRole('button', { name: /^When Linking:/ });
const modeOptions = (page: Page) => page.getByRole('group', { name: 'Linking Options' });

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.route(/\/api\/v1\/metadata\/lookups(?:\?|$)/, (route) => route.abort());
});

async function registerMember(page: Page, origin: string) {
  // First Account - Production assigns the first registered account the administrator role.
  const firstAccount = await request.newContext({ baseURL: origin });
  try {
    const session = await firstAccount.get('/api/v1/session');
    const { csrf_token } = await session.json();
    const registration = await firstAccount.post('/api/v1/session/register', {
      headers: { Origin: origin, 'X-CSRF-Token': csrf_token },
      data: { username: 'matcher-first-account', password: 'synthetic-public-password' },
    });
    expect(registration.status()).toBe(201);
  } finally {
    await firstAccount.dispose();
  }
  await register(page, origin, 'matcher-member');
  const session = await page.request.get(`${origin}/api/v1/session`);
  expect((await session.json()).user?.is_admin).toBe(false);
}

const lastLibraryBook = (page: Page) => page.getByRole('heading', { name: 'Public book 30', exact: true });

const title = (n: number) => `Matcher Test Book ${n}`;
type Document = components['schemas']['Document'];
type DocumentMatch = NonNullable<Document['matches']>[number];
const books: Document[] = Array.from({ length: 12 }, (_, i) => ({
  id: `book-${i + 1}`,
  title: title(i + 1),
  author: 'A. Reader',
  series: null,
  description: null,
  lang: 'en',
  file_available: true,
  cover_available: false,
  media_type: 'application/epub+zip',
  file_size_bytes: 2048,
}));
const candidate = (work_id: string, title: string) => ({
  work_id,
  title,
  author: 'A. Reader',
  url: `https://openlibrary.org/works/${work_id}`,
});
const hardcoverCandidate = {
  work_id: '3848',
  title: 'Primary Candidate',
  author: 'A. Reader',
  url: 'https://hardcover.app/id/book/3848',
};
const primary = { ...candidate('OL123W', 'Primary Candidate'), edition_id: 'OL125M', isbn: '9780765391193' };
const alternative = candidate('OL124W', 'Alternative Candidate');
const match = { work_id: primary.work_id, url: primary.url };

async function mockPages(
  page: Page,
  getMatches: (id: string) => DocumentMatch[] = () => [],
  getBooks: (sort: string | null) => Document[] = () => books,
) {
  const pages: number[] = [];
  await page.route('**/api/v1/documents?*', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('include') !== 'matches') return route.continue();
    const requested = Number(query.get('page') ?? 1);
    pages.push(requested);
    const items = getBooks(query.get('sort'))
      .slice((requested - 1) * 10, requested * 10)
      .map((book) => ({ ...book, matches: getMatches(book.id) }));
    await route.fulfill({
      json: {
        items,
        total: books.length,
        page: requested,
        page_size: 10,
        next_page: requested * 10 < books.length ? requested + 1 : null,
      },
    });
  });
  return pages;
}

test('a library member reviews ten books, writes only explicit link changes, and returns to the same library URL', async ({
  page,
  server,
}) => {
  const links = new Map([['book-2', match]]);
  const writes: string[] = [];
  const documentWrites: string[] = [];
  page.on('request', (request) => {
    if (
      /^(PUT|PATCH|DELETE)$/.test(request.method()) &&
      new URL(request.url()).pathname.startsWith('/api/v1/documents/')
    ) {
      documentWrites.push(new URL(request.url()).pathname);
    }
  });
  let metadataSaved = false;
  const pages = await mockPages(
    page,
    (id) => {
      const link = links.get(id);
      return link ? [{ provider: 'openlibrary', work_id: link.work_id }] : [];
    },
    (sort) =>
      metadataSaved && sort === 'author'
        ? [...books.slice(1, 10), { ...books[0], author: 'A. Revised' }, ...books.slice(10)]
        : books,
  );
  await mockMatcherLookup(page, (id, { document_ids }) => {
    expect(document_ids).not.toContain('book-2');
    return { candidates: id === 'book-1' ? [primary, alternative] : [] };
  });
  let failNextWrite = true;
  const confirmationBodies: unknown[] = [];
  await page.route('**/api/v1/documents/*/matches/openlibrary*', async (route) => {
    const request = route.request();
    const payload = request.method() === 'PUT' ? request.postDataJSON() : null;
    if (payload) confirmationBodies.push(payload);
    if (failNextWrite) {
      failNextWrite = false;
      await route.fulfill({
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Internal Server Error',
          status: 500,
          code: 'storage_error',
        }),
      });
      return;
    }
    const url = new URL(request.url());
    const id = url.pathname.split('/')[4];
    if (payload) {
      const { work_id } = payload;
      writes.push(`link ${id} ${work_id}`);
      links.set(id, { work_id, url: `https://openlibrary.org/works/${work_id}` });
      if (payload.metadata_mode) {
        if (work_id === primary.work_id) metadataSaved = true;
        await route.fulfill({ json: { changed_fields: work_id === primary.work_id ? ['author'] : [] } });
        return;
      }
    } else {
      writes.push(`unlink ${id} ${url.searchParams.get('work_id')}`);
      links.delete(id);
    }
    await route.fulfill({ status: 204 });
  });

  await registerMember(page, server.origin);
  await page.goto(server.origin + libraryURL);
  await page.getByRole('button', { name: 'Load More Shared Books' }).scrollIntoViewIfNeeded();
  await expect(lastLibraryBook(page)).toBeVisible();
  await page.getByRole('main').locator('header').getByRole('link', { name: 'Match Books', exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/library/matcher');
  await providerButton(page).press('Enter');
  const openLibraryOption = providerOptions(page).getByRole('button', { name: 'Open Library', exact: true });
  await expect(openLibraryOption).toBeFocused();
  await expect(openLibraryOption).toHaveAttribute('aria-pressed', 'true');
  await expect(providerOptions(page).getByRole('button', { name: /Hardcover.*Not Configured/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(providerOptions(page)).toBeHidden();
  await expect(providerButton(page)).toBeFocused();
  await expect(modeButton(page)).toHaveText('Link Only');
  const table = page.getByRole('table', { name: 'Open Library associations' });
  const find = (n: number) =>
    table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${title(n)} A`) }) });
  const pick = find(1).getByRole('button', { name: `Choose Match: ${title(1)}` });
  const check = find(1).getByRole('button', { name: `Confirm Match for ${title(1)}` });
  const unlink = (n: number) => find(n).getByRole('button', { name: `Unlink ${title(n)} from Open Library` });
  const pager = page.getByRole('navigation', { name: 'Book Pages' });
  await expect(table.getByRole('rowheader')).toHaveCount(10);
  await expect(pager).toContainText('1–10 of 12');
  await expect(pager.getByRole('button', { name: 'Previous Page' })).toBeDisabled();
  await expect(find(3)).toContainText('No Match');
  await expect(find(3).getByRole('button')).toHaveCount(0);
  await expect(find(2).getByRole('link')).toHaveAttribute('href', match.url);

  await modeButton(page).click();
  await modeOptions(page).getByRole('button', { name: 'Replace Fields' }).click();
  await expect(modeButton(page)).toHaveText('Replace Fields');
  await expect(modeButton(page)).toBeFocused();
  const options = page.getByRole('group', { name: `Matches for ${title(1)}` });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(modeButton(page)).toHaveText('Replace Fields');
    await modeButton(page).click();
    await expect(modeOptions(page).getByRole('button', { name: 'Fill Missing' })).toHaveAccessibleDescription(
      'Fill blank fields and keep existing values.',
    );
    const modeBox = (await modeOptions(page).boundingBox())!;
    expect(modeBox.x).toBeGreaterThanOrEqual(0);
    expect(modeBox.x + modeBox.width).toBeLessThanOrEqual(width);
    await providerButton(page).click();
    await expect(modeOptions(page)).toBeHidden();
    await expect(openLibraryOption).toBeVisible();
    await modeButton(page).click();
    await expect(providerOptions(page)).toBeHidden();
    await expect(modeOptions(page).getByRole('button', { name: 'Replace Fields' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(modeOptions(page)).toBeHidden();
    await expect(providerOptions(page)).toBeHidden();
    await expect(modeButton(page)).toBeFocused();
    await providerButton(page).click();
    await matcherTitle(page).click();
    await expect(providerOptions(page)).toBeHidden();
    await expect(check).toBeVisible();
    expect((await check.boundingBox())?.x).toBe((await unlink(2).boundingBox())?.x);
    await pick.click();
    await expect(options).toBeVisible();
    const box = (await options.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await pick.click();
    await expect(options).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await pick.focus();
  await page.keyboard.press('ArrowDown');
  await expect(options.getByRole('button')).toHaveCount(2);
  await expect(options.getByRole('radio')).toHaveCount(0);
  await expect(options.getByRole('link', { name: /OL124W/ })).toBeVisible();
  await expect(options.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(options.getByRole('button').last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(options).toBeHidden();
  expect(documentWrites).toEqual([]);
  await page.getByRole('button', { name: 'Sort Books', exact: true }).click();
  await page
    .getByRole('group', { name: 'Sort Books', exact: true })
    .getByRole('button', { name: 'Author A–Z' })
    .click();
  await pick.click();
  await options.getByRole('button', { name: /Alternative Candidate/ }).click();
  await check.click();
  await expect(page.getByText(`Could not link ${title(1)}. Use the checkmark to try again.`)).toBeVisible();
  await expect(find(1).getByRole('link')).toHaveCount(0);
  await modeButton(page).click();
  await modeOptions(page).getByRole('button', { name: 'Fill Missing' }).click();
  await pick.click();
  await options.getByRole('button').first().click();
  await expect(find(1).getByRole('button', { name: /Retry Link Change/ })).toHaveCount(0);
  expect(confirmationBodies).toHaveLength(1);
  const pageRequests = pages.length;
  await check.click();
  await expect(find(1).getByRole('link')).toHaveAttribute('href', match.url);
  await expect(page.getByRole('status').filter({ hasText: '1 field filled' })).toBeVisible();
  await expect.poll(() => pages.length).toBeGreaterThan(pageRequests);
  await expect(table.getByRole('rowheader').first()).toContainText(title(2));
  await expect(find(1)).toContainText('A. Revised');
  expect(confirmationBodies).toEqual([
    { work_id: alternative.work_id, metadata_mode: 'replace_fields' },
    { work_id: primary.work_id, metadata_mode: 'fill_missing', edition_id: primary.edition_id, isbn: primary.isbn },
  ]);
  expect(documentWrites).toEqual(Array(2).fill('/api/v1/documents/book-1/matches/openlibrary'));
  await unlink(1).click();
  const unmatched = find(1).getByRole('button', { name: `Unmatched: ${title(1)}` });
  await expect(unmatched).toBeFocused();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(find(1).getByRole('link')).toHaveAttribute('href', match.url);
  expect(confirmationBodies.at(-1)).toEqual({ work_id: primary.work_id });
  await unlink(1).click();
  await expect(unmatched).toBeFocused();
  await unmatched.click();
  await expect(pick).toBeVisible();
  await expect(page.locator(':popover-open')).toHaveCount(0);
  await pick.click();
  await options.getByRole('button', { name: /Alternative Candidate/ }).click();
  await expect(pick).toContainText('Alternative Candidate');
  expect(confirmationBodies).toHaveLength(3);
  await check.click();
  await expect(find(1).getByRole('link')).toHaveAttribute('href', alternative.url);
  await expect(page.getByRole('status').filter({ hasText: 'No metadata changes' })).toBeVisible();
  expect(confirmationBodies.at(-1)).toEqual({ work_id: alternative.work_id, metadata_mode: 'fill_missing' });
  await pager.getByRole('button', { name: 'Next Page' }).click();
  await expect(pager).toContainText('11–12 of 12');
  await expect(pager.getByRole('button', { name: 'Next Page' })).toBeDisabled();
  await expect(table.getByRole('rowheader')).toHaveCount(2);
  await expect(table.getByText('No Match')).toHaveCount(2);
  await pager.getByRole('button', { name: 'Previous Page' }).click();
  await expect(pager).toContainText('1–10 of 12');
  await expect(find(1).getByRole('link')).toHaveAttribute('href', alternative.url);
  expect(writes).toEqual([
    'link book-1 OL123W',
    'unlink book-1 OL123W',
    'link book-1 OL123W',
    'unlink book-1 OL123W',
    'link book-1 OL124W',
  ]);
  expect((await page.reload())?.ok()).toBe(true);
  await expect(page).toHaveURL((url) => url.pathname === '/library/matcher');
  await expect(table).toBeVisible();
  await expect(modeButton(page)).toHaveText('Link Only');
  await backToLibrary(page).click();
  await expect(page).toHaveURL(server.origin + libraryURL);
  await expect(page.getByRole('searchbox', { name: 'Search title or author' })).toHaveValue('Public book');
  await expect(lastLibraryBook(page)).toBeVisible();
});

test('confirming a second provider waits for fresh book metadata, including after a failed refresh', async ({
  page,
  server,
}) => {
  let revised = false;
  await mockPages(
    page,
    () => [],
    () => (revised ? [{ ...books[0], title: 'Revised title' }] : [books[0]]),
  );
  await page.route('**/api/v1/metadata/providers', (route) =>
    route.fulfill({ json: { selected: 'openlibrary', effective: 'openlibrary', hardcover_available: true } }),
  );
  await mockMatcherLookup(page, (_, { provider }) => ({
    candidates: [provider === 'hardcover' ? hardcoverCandidate : primary],
  }));
  let finishWrite!: () => void;
  const write = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  await page.route('**/api/v1/documents/book-1/matches/openlibrary', async (route) => {
    await write;
    revised = true;
    await route.fulfill({ json: { changed_fields: ['title'] } });
  });
  await register(page, server.origin, 'matcher-refresh');
  await page.goto(server.origin + '/library/matcher');
  await modeButton(page).click();
  await modeOptions(page).getByRole('button', { name: 'Replace Fields' }).click();
  const check = page.getByRole('button', { name: `Confirm Match for ${title(1)}` });
  await check.click();
  await providerButton(page).click();
  await providerOptions(page).getByRole('button', { name: 'Hardcover', exact: true }).click();
  await expect(check).toBeDisabled();
  let failRefresh!: () => void;
  const refresh = new Promise<void>((resolve) => {
    failRefresh = resolve;
  });
  await page.route(
    '**/api/v1/documents?*',
    async (route) => {
      await refresh;
      await route.fulfill({ status: 500 });
    },
    { times: 1 },
  );
  finishWrite();
  await expect(page.getByRole('status').filter({ hasText: '1 field updated' })).toBeVisible();
  await expect(check).toBeDisabled();
  failRefresh();
  await expect(page.getByRole('alert')).toContainText('Could not load this page');
  await expect(check).toBeDisabled();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm Match for Revised title' })).toBeEnabled();
});

test('direct matcher entry requires sign-in; streams render incrementally and cancel on navigation', async ({
  page,
  server,
}) => {
  const matcherURL = `${server.origin}/library/matcher`;
  const anonymousRequests: string[] = [];
  const recordAnonymousRequest = (request: import('@playwright/test').Request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/v1/metadata/') || url.searchParams.get('include') === 'matches')
      anonymousRequests.push(url.pathname);
  };
  page.on('request', recordAnonymousRequest);
  expect((await page.goto(matcherURL))?.ok()).toBe(true);
  await expect(page).toHaveURL(`${server.origin}/login`);
  await expect(matcherTitle(page)).toHaveCount(0);
  expect(anonymousRequests).toEqual([]);
  page.off('request', recordAnonymousRequest);

  const pages = await mockPages(page, (id) =>
    id === 'book-10'
      ? [
          { provider: 'hardcover', work_id: '6271' },
          { provider: 'openlibrary', work_id: 'OL71W' },
        ]
      : [],
  );
  await page.route('**/api/v1/metadata/providers', (route) =>
    route.fulfill({ json: { selected: 'hardcover', effective: 'hardcover', hardcover_available: true } }),
  );
  await page.addInitScript(() => {
    type StreamControl = {
      emit(line: unknown): void;
      close(): void;
      signal: AbortSignal;
      provider: string;
      ids: string[];
    };
    const state = window as Window & { matcherStreams: StreamControl[] };
    state.matcherStreams = [];
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (!new URL(request.url).pathname.endsWith('/metadata/lookups')) return original(input, init);
      const { provider, document_ids: ids } = await request.json();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          state.matcherStreams.push({
            provider,
            ids,
            signal: request.signal,
            emit(line) {
              controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'));
            },
            close() {
              controller.close();
            },
          });
        },
      });
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  });
  await register(page, server.origin, 'matcher-stream-reader');
  expect((await page.goto(matcherURL))?.ok()).toBe(true);
  const current = page.getByRole('table');
  await expect(current.getByText('Searching…', { exact: true })).toHaveCount(9);
  await expect(current.getByRole('link', { name: /6271 on Hardcover/ })).toBeVisible();
  await expect(providerButton(page)).toHaveAccessibleName('Provider: Hardcover');
  await expect
    .poll(() => page.evaluate(() => window.matcherStreams.map((stream) => stream.provider)))
    .toEqual(['hardcover']);
  await page.evaluate(
    (item) => window.matcherStreams[0].emit({ document_id: 'book-1', candidates: [item] }),
    hardcoverCandidate,
  );
  await expect(current.getByRole('button', { name: `Choose Match: ${title(1)}`, exact: true })).toContainText(
    'Primary Candidate',
  );
  await expect(current.getByText('Searching…', { exact: true })).toHaveCount(8);
  await providerButton(page).click();
  await expect(providerOptions(page).getByRole('button', { name: 'Hardcover', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await providerOptions(page).getByRole('button', { name: 'Open Library', exact: true }).click();
  await expect(providerButton(page)).toHaveAccessibleName('Provider: Open Library');
  await expect(providerButton(page)).toBeFocused();
  await expect(providerOptions(page)).toBeHidden();
  await expect(page.getByRole('table', { name: 'Open Library associations' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.matcherStreams.map((item) => [item.provider, item.signal.aborted])))
    .toEqual([
      ['hardcover', true],
      ['openlibrary', false],
    ]);
  await expect(current.getByRole('link', { name: /OL71W on Open Library/ })).toBeVisible();
  expect(pages).toEqual([1]);
  expect(await page.evaluate(() => window.matcherStreams.map((item) => item.ids.includes('book-10')))).toEqual([
    false,
    false,
  ]);
  await page.evaluate(() => {
    window.matcherStreams[1].emit({ document_id: 'book-2', error: 'rate_limited' });
    window.matcherStreams[1].close();
  });
  await expect(current.getByText('No Match')).toHaveCount(0);
  await expect(current.getByRole('button', { name: `Retry Lookup: ${title(3)}` })).toBeVisible(); // The stream ended without this row.
  const retry = current.getByRole('button', { name: `Retry Lookup: ${title(2)}` });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect.poll(() => page.evaluate(() => window.matcherStreams[2]?.ids)).toEqual(['book-2']);
  await page.evaluate(() => {
    window.matcherStreams[2].emit({ document_id: 'book-2', candidates: [] });
    window.matcherStreams[2].close();
  });
  await expect(current.getByText('No Match')).toHaveCount(1);
  await expect(retry).toHaveCount(0);

  await page.getByRole('button', { name: 'Next Page' }).click();
  await expect.poll(() => page.evaluate(() => window.matcherStreams[3]?.ids)).toEqual(['book-11', 'book-12']);
  expect(pages).toEqual([1, 2]);
  await backToLibrary(page).click();
  await expect(page).toHaveURL(`${server.origin}/library`);
  await expect.poll(() => page.evaluate(() => window.matcherStreams[3].signal.aborted)).toBe(true);
});

test('matcher sorts the full catalog before paging and preserves the provider and Library view', async ({
  page,
  server,
}) => {
  await page.route('**/api/v1/metadata/providers', (route) =>
    route.fulfill({ json: { selected: 'openlibrary', effective: 'openlibrary', hardcover_available: true } }),
  );
  await mockMatcherLookup(page, () => ({ candidates: [] }));
  await register(page, server.origin, 'matcher-sort-reader');
  const { csrf_token, user } = await (await page.request.get(`${server.origin}/api/v1/session`)).json();
  const headers = {
    Origin: server.origin,
    'X-CSRF-Token': csrf_token,
    'X-AnthoLume-Reading-Generation': user.reading_generation,
  };
  for (const [path, data] of [
    ['devices', { id: 'matcher-sort-device', name: 'Matcher sort device' }],
    [
      'reading-progress',
      {
        event_id: randomUUID(),
        document_id: 'book_030',
        device_id: 'matcher-sort-device',
        observed_at: new Date().toISOString(),
        base_revision: '0',
        position: '/body/DocFragment[1]/body/p[2]',
        fraction: 0.24,
      },
    ],
  ] as const) {
    const response = await page.request.post(`${server.origin}/api/v1/me/${path}`, { headers, data });
    expect(response.status(), await response.text()).toBe(200);
  }

  const originalLibrary = `${server.origin}/library?q=Public+book+01&sort=author`;
  await page.goto(originalLibrary);
  await page.getByRole('link', { name: 'Match Books', exact: true }).click();
  const sort = page
    .getByRole('main')
    .locator('header')
    .filter({ has: page.getByRole('link', { name: 'Library', exact: true }) })
    .getByRole('button', { name: 'Sort Books', exact: true });
  const options = page.getByRole('group', { name: 'Sort Books', exact: true });
  const option = (name: string) => options.getByRole('button', { name, exact: true });
  const pager = page.getByRole('navigation', { name: 'Book Pages' });
  const rows = page.getByRole('table').getByRole('rowheader');
  const bookRow = (n: number) => new RegExp(`^Public book ${String(n).padStart(2, '0')}(?!\\d)`);
  await expect(pager).toContainText('1–10 of 30');
  await expect(rows).toHaveText([30, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(bookRow));
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await sort.click();
    await expect(option('Last Read')).toHaveAttribute('aria-pressed', 'true');
    const triggerBox = (await sort.boundingBox())!;
    const optionsBox = (await options.boundingBox())!;
    expect(optionsBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height);
    expect(optionsBox.x).toBeGreaterThanOrEqual(0);
    expect(optionsBox.x + optionsBox.width).toBeLessThanOrEqual(width);
    await option('Last Read').click();
    await expect(options).toBeHidden();
    await expect(sort).toBeFocused();
  }
  await sort.click();
  await expect(option('Author A–Z')).toBeEnabled();
  await expect(option('Recently Added')).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(options).toBeHidden();

  await modeButton(page).click();
  await modeOptions(page).getByRole('button', { name: 'Fill Missing' }).click();
  await expect(providerButton(page)).toHaveAccessibleName('Provider: Open Library');
  await providerButton(page).click();
  await providerOptions(page).getByRole('button', { name: 'Hardcover', exact: true }).click();
  await pager.getByRole('button', { name: 'Next Page' }).click();
  await expect(pager).toContainText('11–20 of 30');
  await expect(rows.first()).toHaveText(bookRow(10));
  await sort.click();
  await option('Title A–Z').click();
  await expect(pager).toContainText('1–10 of 30');
  await expect(pager.getByRole('button', { name: 'Previous Page' })).toBeDisabled();
  await expect(rows).toHaveText([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(bookRow));
  await expect(providerButton(page)).toHaveAccessibleName('Provider: Hardcover');
  await modeButton(page).click();
  await expect(modeOptions(page).getByRole('button', { name: 'Fill Missing' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await sort.click();
  await expect(option('Title A–Z')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(options).toBeHidden();

  await backToLibrary(page).click();
  await expect(page).toHaveURL(originalLibrary);
  await expect(page.getByRole('searchbox', { name: 'Search title or author' })).toHaveValue('Public book 01');
  await page.getByRole('button', { name: 'Sort Books', exact: true }).click();
  await expect(option('Author A–Z')).toHaveAttribute('aria-pressed', 'true');
});

declare global {
  interface Window {
    matcherStreams: {
      emit(line: unknown): void;
      close(): void;
      signal: AbortSignal;
      provider: string;
      ids: string[];
    }[];
  }
}
