import { afterEach, expect, test, vi } from 'vitest';
import { matcherLookupRequest, readMatcherResults, type MatcherResult } from './bookMatcher';
import { APIUnavailable } from './transport';
import { InvalidResponse } from './validate';

const encoder = new TextEncoder();
const candidate = { work_id: 'OL1W', title: '雪 Café', author: '夏目', url: 'https://openlibrary.org/works/OL1W', edition_id: 'OL2M', isbn: '9780765391193' };
const first = { document_id: 'a', candidates: [candidate] };
const empty = { document_id: 'b', candidates: [] };
const line = (value: unknown) => JSON.stringify(value) + '\n';
const body = (text: string) => new Response(text).body!;
const signal = () => new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

async function matcherAPI() {
  const account = { origin: 'https://books.example', userId: 'reader', readingGeneration: 'generation' };
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal('window', { location: { origin: account.origin } });
  vi.stubGlobal('fetch', fetch);
  const { createAPI } = await import('./client');
  let epoch = 0;
  const gate = {
    epoch: () => epoch, token: () => 'csrf', changed: vi.fn(), expired: vi.fn(), suspectOutage: vi.fn(),
    assert(initiating: typeof account, originalEpoch: number) {
      if (initiating !== account || originalEpoch !== epoch) throw new DOMException('Account changed', 'AbortError');
    },
  };
  return { account, api: createAPI(gate), fetch, gate, advanceEpoch: () => { epoch++; } };
}

test('validates lookup size, identity and uniqueness before sending', () => {
  expect(matcherLookupRequest('openlibrary', ['a/b', '雪'])).toEqual({ provider: 'openlibrary', document_ids: ['a/b', '雪'] });
  for (const ids of [[], ['a', 'a'], [''], ['x'.repeat(129)], Array.from({ length: 11 }, (_, i) => String(i))]) {
    expect(() => matcherLookupRequest('openlibrary', ids)).toThrow(TypeError);
  }
});

test('delivers outcomes in completion order before closing and decodes split UTF-8', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const received: MatcherResult[] = [];
  const onResult = vi.fn((result: MatcherResult) => received.push(result));
  const reading = readMatcherResults(new ReadableStream({ start(controller) { stream = controller; } }), ['a', 'b', 'c', 'd'], signal(), onResult);
  for (const byte of encoder.encode(line(empty) + line(first).replace(/\n$/, '\r\n'))) stream.enqueue(Uint8Array.of(byte));
  await vi.waitFor(() => expect(received).toEqual([empty, first]));
  const error = { document_id: 'c', error: 'rate_limited' };
  const match = { document_id: 'd', match: { work_id: candidate.work_id, url: candidate.url } };
  stream.enqueue(encoder.encode(line(error) + line(match)));
  stream.close();
  await reading;
  expect(received).toEqual([empty, first, error, match]);
});

test('rejects incomplete and invalid streams without acknowledging the bad row', async () => {
  const cases = [JSON.stringify(empty), '{"document_id":', line(first), line(first) + line(first), line(first) + line({ ...empty, document_id: 'other' }),
    line({ ...first, error: 'rate_limited' }), line({ document_id: 'a', candidates: null }),
    ...[{ url: 'javascript:alert(1)' }, { edition_id: '' }, { edition_id: undefined }, { isbn: 'bad-isbn' }].map(fields => line({ ...first, candidates: [{ ...candidate, ...fields }] }))];
  for (const text of cases) {
    const onResult = vi.fn();
    await expect(readMatcherResults(body(text), ['a', 'b'], signal(), onResult)).rejects.toBeInstanceOf(InvalidResponse);
    expect(onResult.mock.calls.map(([result]) => result)).toEqual(text.startsWith(line(first)) ? [first] : []);
  }
  const invalidUTF8 = new Response(Uint8Array.of(0xc3, 0x28)).body!;
  await expect(readMatcherResults(invalidUTF8, ['a'], signal(), vi.fn())).rejects.toBeInstanceOf(InvalidResponse);
});

test('aborting an idle stream cancels the reader and does not deliver a result', async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  const onResult = vi.fn();
  const reading = readMatcherResults(new ReadableStream({ cancel }), ['a'], controller.signal, onResult);
  controller.abort();
  await expect(reading).rejects.toBe(controller.signal.reason);
  expect(cancel).toHaveBeenCalledOnce();
  expect(onResult).not.toHaveBeenCalled();
});

test('the matcher reads standard documents with associations for both providers', async () => {
  const { account, api, fetch } = await matcherAPI();
  const book = { id: 'book', title: 'Book', author: null, series: null, description: null, lang: null, file_available: false, cover_available: false, media_type: null, file_size_bytes: null };
  const matches = [{ provider: 'openlibrary', work_id: 'OL1W' }, { provider: 'hardcover', work_id: '42' }];
  const result = (item: object) => Response.json({ items: [item], page: 1, page_size: 10, total: 1, next_page: null });
  fetch.mockImplementationOnce(async input => {
    if (!(input instanceof Request)) throw new Error('Expected Request');
    const url = new URL(input.url);
    expect(url.pathname).toBe('/api/v1/documents');
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: '1', page_size: '10', sort: 'title', include: 'matches' });
    expect(input.headers.get('x-antholume-account')).toBe(account.userId);
    return result({ ...book, matches });
  });
  await expect(api.matcherPage(account, 1, signal())).resolves.toMatchObject({ items: [{ matches }] });
  for (const item of [book, { ...book, matches: [matches[0], matches[0]] }]) {
    fetch.mockResolvedValueOnce(result(item));
    await expect(api.matcherPage(account, 1, signal())).rejects.toBeInstanceOf(InvalidResponse);
  }
});

test('the authenticated POST sends CSRF and account headers and guards every streamed outcome', async () => {
  const { account, api, fetch, gate, advanceEpoch } = await matcherAPI();
  fetch.mockImplementationOnce(async input => {
    expect(input).toBeInstanceOf(Request);
    if (!(input instanceof Request)) throw new Error('Expected Request');
    expect(input.method).toBe('POST');
    expect(new URL(input.url).pathname).toBe('/api/v1/metadata/lookups');
    expect(input.headers.get('x-csrf-token')).toBe('csrf');
    expect(input.headers.get('x-antholume-account')).toBe(account.userId);
    expect(input.headers.get('x-antholume-reading-generation')).toBe(account.readingGeneration);
    expect(input.headers.get('accept')).toBe('application/x-ndjson, application/problem+json');
    expect(await input.json()).toEqual({ provider: 'openlibrary', document_ids: ['a', 'b'] });
    return new Response(line(first) + line(empty), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
  });
  const onResult = vi.fn(advanceEpoch);
  await expect(api.matcherLookups(account, 'openlibrary', ['a', 'b'], signal(), onResult)).rejects.toMatchObject({ name: 'AbortError' });
  expect(onResult).toHaveBeenCalledExactlyOnceWith(first);
  expect(gate.suspectOutage).not.toHaveBeenCalled();

  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ type: 'about:blank', title: 'Unauthorized', status: 401, code: 'account_changed', detail: 'Account changed.' }), {
    status: 401, headers: { 'Content-Type': 'application/problem+json' },
  }));
  await expect(api.matcherLookups(account, 'openlibrary', ['a'], signal(), vi.fn())).rejects.toMatchObject({ name: 'AbortError' });
  expect(gate.changed).toHaveBeenCalledExactlyOnceWith(account);

  fetch.mockResolvedValueOnce(new Response(new ReadableStream({ pull(stream) { stream.error(new TypeError('Connection reset')); } }), {
    headers: { 'Content-Type': 'application/x-ndjson' },
  }));
  await expect(api.matcherLookups(account, 'openlibrary', ['a'], signal(), vi.fn())).rejects.toBeInstanceOf(APIUnavailable);
  expect(gate.suspectOutage).toHaveBeenCalledOnce();
});
