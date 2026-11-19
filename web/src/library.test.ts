import { expect, it } from 'vitest';
import { bookKey, bookPath, combineBooks, matchesBook, sortBooks } from './library';
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
it('sorts unread books after read books without hiding local copies', () => {
  const local = stored({ kind: 'local', localId: 'one' });
  const books = combineBooks([local], [doc], a);
  local.lastReadAt = '2026-01-01T00:00:00.000Z';
  expect(sortBooks(books, 'read').map(book => book.ref.kind)).toEqual(['local', 'server']);
  expect(books.filter(book => matchesBook(book, 'writer'))).toHaveLength(1);
});
it('routes preserve opaque IDs and account/origin intent', () => {
  const ref = { kind: 'server' as const, account: a, documentId: 'opaque/id' };
  expect(bookPath(ref, 'read')).toBe('/read/server/opaque%2Fid?account=a&origin=https%3A%2F%2Fbooks.example');
  expect(bookKey(ref)).not.toBe(bookKey({ ...ref, account: b }));
});
