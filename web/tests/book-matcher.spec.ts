import { request, type Page } from '@playwright/test';
import type { components } from '../src/api/schema.gen';
import { expect, mockMatcherLookup, register, test } from './fixtures';

const libraryURL = '/library?q=Public+book&sort=author';
const matcherTitle = (page: Page) => page.getByRole('heading', { name: 'Book Matcher', exact: true });
const backToLibrary = (page: Page) => page.getByRole('main').getByRole('link', { name: /^(?:Back to )?Library$/i });

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
const primary = candidate('OL123W', 'Primary Candidate');
const alternative = candidate('OL124W', 'Alternative Candidate');
const match = { work_id: primary.work_id, url: primary.url };

async function mockPages(page: Page, getMatches: (id: string) => DocumentMatch[] = () => []) {
  const pages: number[] = [];
  await page.route('**/api/v1/documents?*', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('include') !== 'matches') return route.continue();
    const requested = Number(query.get('page') ?? 1);
    pages.push(requested);
    const items = books
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
  await mockPages(page, (id) => {
    const link = links.get(id);
    return link ? [{ provider: 'openlibrary', work_id: link.work_id }] : [];
  });
  await mockMatcherLookup(page, (id, { document_ids }) => {
    expect(document_ids).not.toContain('book-2');
    return { candidates: id === 'book-1' ? [primary, alternative] : [] };
  });
  let failNextWrite = true;
  await page.route('**/api/v1/documents/*/matches/openlibrary*', async (route) => {
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
    const url = new URL(route.request().url());
    const id = url.pathname.split('/')[4];
    if (route.request().method() === 'PUT') {
      const { work_id } = route.request().postDataJSON() as { work_id: string };
      writes.push(`link ${id} ${work_id}`);
      links.set(id, { work_id, url: `https://openlibrary.org/works/${work_id}` });
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
  const provider = page.getByRole('combobox', { name: 'Provider', exact: true });
  await expect(provider.getByRole('option', { name: 'Hardcover (Not Configured)' })).toBeDisabled();
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

  const options = page.getByRole('group', { name: `Matches for ${title(1)}` });
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
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
  expect(writes).toEqual([]);
  await check.click();
  await expect(find(1).getByText('Could Not Link', { exact: true })).toBeVisible();
  await expect(find(1).getByRole('link')).toHaveCount(0);
  await find(1)
    .getByRole('button', { name: `Retry Link Change: ${title(1)}` })
    .click();
  await expect(find(1).getByRole('link')).toHaveAttribute('href', match.url);
  await expect(page.getByRole('status').filter({ hasText: `Linked ${title(1)}` })).toBeVisible();
  await unlink(1).click();
  const unmatched = find(1).getByRole('button', { name: `Unmatched: ${title(1)}` });
  await expect(unmatched).toBeFocused();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(find(1).getByRole('link')).toHaveAttribute('href', match.url);
  await unlink(1).click();
  await unmatched.click();
  await expect(pick).toBeVisible();
  await expect(page.locator(':popover-open')).toHaveCount(0);
  await pick.click();
  await page
    .getByRole('group', { name: `Matches for ${title(1)}` })
    .getByRole('button', { name: /Alternative Candidate/ })
    .click();
  await expect(find(1).getByRole('link')).toHaveAttribute('href', alternative.url);
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
  await backToLibrary(page).click();
  await expect(page).toHaveURL(server.origin + libraryURL);
  await expect(page.getByRole('searchbox', { name: 'Search title or author' })).toHaveValue('Public book');
  await expect(lastLibraryBook(page)).toBeVisible();
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
  const select = page.getByRole('combobox', { name: 'Provider', exact: true });
  const current = page.getByRole('table');
  await expect(current.getByText('Searching…', { exact: true })).toHaveCount(9);
  await expect(current.getByRole('link', { name: /6271 on Hardcover/ })).toBeVisible();
  await expect(select).toHaveValue('hardcover');
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
  await select.selectOption('openlibrary');
  await expect(page.getByRole('heading', { name: 'Book Matcher' })).toBeFocused();
  await expect(page.locator('select:open')).toHaveCount(0);
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
