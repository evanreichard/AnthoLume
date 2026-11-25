import { expect, it } from 'vitest';
import { bookKey, bookPath, combineBooks, matcherReturn, sortBooks } from './library';
import type { StoredBook } from './reading';

const a = { origin: 'https://books.example', userId: 'a' };
const b = { origin: 'https://books.example', userId: 'b' };
const stored = (ref: StoredBook['ref']): StoredBook => ({ ref, title: 'Identical', author: 'Author', cover: null, availability: 'available', checkpoint: { position: null, fraction: null } });
const doc = { id: 'book', title: 'Live title', author: 'Writer', series: null, description: null, lang: null, file_available: true, cover_available: false, media_type: 'application/epub+zip', file_size_bytes: 100 };
it('merges only composite server identities across real pages, never local records or accounts', () => {
  const local = stored({ kind: 'local', localId: 'book' });
  const sharedA = stored({ kind: 'server', account: a, documentId: 'book' });
  const sharedB = stored({ kind: 'server', account: b, documentId: 'book' });
  const result = combineBooks([local, sharedA, sharedB], [doc, doc], a);
  expect(result).toHaveLength(2);
  expect(result.find((book) => book.ref.kind === 'server')?.stored).toBe(sharedA);
  expect(result.find((book) => book.ref.kind === 'server')?.title).toBe('Live title');
  expect(new Set(result.map((book) => bookKey(book.ref))).size).toBe(2);
  expect(combineBooks([local, sharedA, sharedB], [], b).map((book) => book.ref)).toEqual([local.ref, sharedB.ref]);
  expect(combineBooks([local, sharedA], [], null).map((book) => book.ref)).toEqual([local.ref]);
});
it('never joins a restored book with the previous generation’s cached copy', () => {
  const current = { ...a, readingGeneration: 'current' };
  const previous = stored({ kind: 'server', account: { ...a, readingGeneration: 'previous' }, documentId: doc.id });
  const [book] = combineBooks([previous], [doc], current);
  expect(book?.document).toEqual(doc);
  expect(book?.stored).toBeUndefined();
  expect(combineBooks([previous], [], current)).toEqual([]);
});
it('sorts Last read by newest shared checkpoint, then puts unread books last', () => {
  const cached = { ...stored({ kind: 'server', account: a, documentId: 'older' }), lastReadAt: '2026-01-03T00:00:00Z' };
  const books = combineBooks([cached], [
    { ...doc, id: 'unread', title: 'A unread' },
    { ...doc, id: 'older', title: 'B older', last_read_at: '2026-01-01T00:00:00Z' },
    { ...doc, id: 'newer', title: 'C newer', last_read_at: '2026-01-02T00:00:00Z' },
  ], a);
  expect(sortBooks(books, 'read').map(book => book.document?.id)).toEqual(['newer', 'older', 'unread']);
});
it('restores matcher navigation only for the initiating account and generation', () => {
  const account = { ...a, readingGeneration: 'current' };
  const state = { account, search: 'q=Public+book&sort=author&dialog=add', pages: 3 };
  expect(matcherReturn(state, account)).toEqual({ ...state, search: 'q=Public+book&sort=author' });
  expect(matcherReturn(state, b)).toBeNull();
  expect(matcherReturn(state, { ...account, readingGeneration: 'previous' })).toBeNull();
  expect(matcherReturn({ ...state, pages: 1.5 }, account)).toBeNull();
});
it('routes preserve opaque IDs and account/origin intent', () => {
  const ref = { kind: 'server' as const, account: a, documentId: 'opaque/id' };
  expect(bookPath(ref, 'read')).toBe('/read/server?id=opaque%2Fid&account=a&origin=https%3A%2F%2Fbooks.example');
  expect(bookKey(ref)).not.toBe(bookKey({ ...ref, account: b }));
});
