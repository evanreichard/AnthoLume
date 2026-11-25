import { DatabaseSync } from 'node:sqlite';
import type { Page } from '@playwright/test';
import { expect, register, test } from './fixtures';

async function enterMatcher(page: Page, origin: string, data: string) {
  await register(page, origin, 'matcher-owner');
  const db = new DatabaseSync(`${data}/browser.db`);
  try { db.prepare('UPDATE users SET admin=1 WHERE id=?').run('matcher-owner'); }
  finally { db.close(); }
  await page.goto(`${origin}/admin/library`);
  await page.getByRole('link', { name: 'Open Book Matcher' }).click();
  await expect(page.getByRole('heading', { name: 'Book Matcher' })).toBeVisible();
}

const title = (n: number) => `Matcher Test Book ${n}`;
const books = Array.from({ length: 12 }, (_, i) => ({ id: `book-${i + 1}`, title: title(i + 1), author: 'A. Reader' }));
const candidate = (work_id: string, title: string, provider = 'openlibrary') => ({ work_id, title, author: 'A. Reader', url: `https://${provider}.org/works/${work_id}` });
const primary = candidate('OL123W', 'Primary Candidate');
const alternative = candidate('OL124W', 'Alternative Candidate');
const match = { work_id: primary.work_id, url: primary.url };

async function mockPages(page: Page, getMatch: (id: string) => typeof match | undefined = () => undefined) {
  await page.route('**/api/v1/admin/book-matcher?*', async route => {
    const requested = Number(new URL(route.request().url()).searchParams.get('page') ?? 1);
    const items = books.slice((requested - 1) * 10, requested * 10).map(book => ({ ...book, match: getMatch(book.id) }));
    await route.fulfill({ json: { items, total: books.length, page: requested } });
  });
}

const ndjson = (items: object[]) => ({ contentType: 'application/x-ndjson', body: items.map(item => JSON.stringify(item) + '\n').join('') });

test('the matcher reviews ten books, uses a native picker, and writes only explicit link changes', async ({ page, server }) => {
  const links = new Map([['book-2', match]]);
  const writes: string[] = [];
  const searches: string[][] = [];
  await mockPages(page, id => links.get(id));
  await page.route('**/api/v1/admin/book-matcher/lookups', async route => {
    const { document_ids: ids } = route.request().postDataJSON() as { document_ids: string[] };
    searches.push(ids);
    await route.fulfill(ndjson(ids.map(document_id => ({ document_id, candidates: ['book-1', 'book-2'].includes(document_id) ? [primary, alternative] : [] }))));
  });
  let failNextWrite = true;
  await page.route('**/api/v1/admin/documents/*/matches/openlibrary*', async route => {
    if (failNextWrite) {
      failNextWrite = false;
      await route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Internal Server Error', status: 500, code: 'storage_error' }) });
      return;
    }
    const url = new URL(route.request().url());
    const id = url.pathname.split('/')[5];
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

  await enterMatcher(page, server.origin, server.data);
  const provider = page.getByRole('combobox', { name: 'Provider', exact: true });
  await expect(provider.getByRole('option', { name: 'Hardcover (Not Configured)' })).toBeDisabled();
  const table = page.getByRole('table', { name: 'Open Library associations' });
  const find = (n: number) => table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${title(n)} A`) }) });
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
  expect(searches[0]).not.toContain('book-2');

  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(check).toBeVisible();
    expect((await check.boundingBox())?.x).toBe((await unlink(2).boundingBox())?.x);
    await pick.click();
    const options = page.getByRole('group', { name: `Matches for ${title(1)}` });
    await expect(options).toBeVisible();
    await expect(options.getByRole('button')).toHaveCount(2);
    await expect(options.getByRole('radio')).toHaveCount(0);
    await expect(options.getByRole('link', { name: /OL124W/ })).toBeVisible();
    const box = await options.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(options).not.toBeVisible();
    await pick.focus();
    await page.keyboard.press('ArrowDown');
    await expect(options.getByRole('button').first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(options.getByRole('button').last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(options).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  expect(writes).toEqual([]);
  await check.click();
  await expect(find(1).getByText('Could Not Link', { exact: true })).toBeVisible();
  await expect(find(1).getByRole('link')).toHaveCount(0);
  await find(1).getByRole('button', { name: `Retry Link Change: ${title(1)}` }).click();
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
  await page.getByRole('group', { name: `Matches for ${title(1)}` }).getByRole('button', { name: /Alternative Candidate/ }).click();
  await expect(find(1).getByRole('link')).toHaveAttribute('href', alternative.url);
  await pager.getByRole('button', { name: 'Next Page' }).click();
  await expect(pager).toContainText('11–12 of 12');
  await expect(pager.getByRole('button', { name: 'Next Page' })).toBeDisabled();
  await expect(table.getByRole('rowheader')).toHaveCount(2);
  await expect(table.getByText('No Match')).toHaveCount(2);
  await pager.getByRole('button', { name: 'Previous Page' }).click();
  await expect(pager).toContainText('1–10 of 12');
  await expect(find(1).getByRole('link')).toHaveAttribute('href', alternative.url);
  expect(searches.at(-1)).toEqual(['book-11', 'book-12']);
  expect(writes).toEqual(['link book-1 OL123W', 'unlink book-1 OL123W', 'link book-1 OL123W', 'unlink book-1 OL123W', 'link book-1 OL124W']);
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Administration sections' })).toBeVisible();
});

test('streamed results render before completion; provider changes abort old streams and missing results stay retryable', async ({ page, server }) => {
  await mockPages(page);
  await page.route('**/api/v1/admin/metadata-provider', route => route.fulfill({ json: { selected: 'hardcover', effective: 'hardcover', hardcover_available: true } }));
  await page.addInitScript(() => {
    type StreamControl = { emit(line: unknown): void; close(): void; signal: AbortSignal; provider: string; ids: string[] };
    const state = window as Window & { matcherStreams: StreamControl[] };
    state.matcherStreams = [];
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (!new URL(request.url).pathname.endsWith('/book-matcher/lookups')) return original(input, init);
      const { provider, document_ids: ids } = await request.json();
      let canceled = false;
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        const encoder = new TextEncoder();
        state.matcherStreams.push({ provider, ids, signal: request.signal,
          emit(line) { if (!canceled) controller.enqueue(encoder.encode(JSON.stringify(line) + '\n')); },
          close() { if (!canceled) controller.close(); } });
      }, cancel() { canceled = true; } });
      return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
    };
  });
  await enterMatcher(page, server.origin, server.data);
  const select = page.getByRole('combobox', { name: 'Provider', exact: true });
  const current = page.getByRole('table');
  await expect(current.getByText('Searching…', { exact: true })).toHaveCount(10);
  await expect(select).toHaveValue('hardcover');
  await expect.poll(() => page.evaluate(() => window.matcherStreams.map(stream => stream.provider))).toEqual(['hardcover']);
  await page.evaluate(item => window.matcherStreams[0].emit({ document_id: 'book-1', candidates: [item] }), primary);
  await expect(current.getByRole('button', { name: `Choose Match: ${title(1)}`, exact: true })).toContainText('Primary Candidate');
  await expect(current.getByText('Searching…', { exact: true })).toHaveCount(9);
  await select.selectOption('openlibrary');
  await expect(page.getByRole('heading', { name: 'Book Matcher' })).toBeFocused();
  await expect(page.locator('select:open')).toHaveCount(0);
  await expect(page.getByRole('table', { name: 'Open Library associations' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.matcherStreams.map(item => [item.provider, item.signal.aborted]))).toEqual([['hardcover', true], ['openlibrary', false]]);
  await page.evaluate(() => {
    window.matcherStreams[0].emit({ document_id: 'book-2', candidates: [{ work_id: 'OL999W', url: 'https://openlibrary.org/works/OL999W', title: 'Stale Result', author: '' }] });
    window.matcherStreams[0].close();
    window.matcherStreams[1].emit({ document_id: 'book-2', error: 'rate_limited' });
    window.matcherStreams[1].close();
  });
  await expect(current.getByText('Stale Result')).toHaveCount(0);
  await expect(current.getByText('No Match')).toHaveCount(0);
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
  await expect(page.getByRole('navigation', { name: 'Book Pages' })).toContainText('11–12 of 12');
  await expect.poll(() => page.evaluate(() => window.matcherStreams[3]?.ids)).toEqual(['book-11', 'book-12']);
  await page.getByRole('link', { name: 'Administration', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.matcherStreams[3].signal.aborted)).toBe(true);
});

declare global {
  interface Window {
    matcherStreams: { emit(line: unknown): void; close(): void; signal: AbortSignal; provider: string; ids: string[] }[];
  }
}
