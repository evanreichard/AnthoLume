import { expect, it } from 'vitest';
import { bookKey, bookPath, combineBooks, filterBooks } from './library';
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
it('filters source and availability independently, after privacy projection', () => {
  const local = stored({ kind: 'local', localId: 'one' });
  const books = combineBooks([local], [doc], a);
  expect(filterBooks(books, '', 'all', 'all')).toHaveLength(2);
  expect(filterBooks(books, 'author', 'local', 'available')).toHaveLength(1);
  expect(filterBooks(books, '', 'server', 'unavailable')).toHaveLength(1);
  expect(filterBooks(books, '', 'local', 'unavailable')).toHaveLength(0);
});
it('routes preserve opaque IDs and account/origin intent', () => {
  const ref = { kind: 'server' as const, account: a, documentId: 'opaque/id' };
  expect(bookPath(ref, 'read')).toBe('/read/server/opaque%2Fid?account=a&origin=https%3A%2F%2Fbooks.example');
  expect(bookKey(ref)).not.toBe(bookKey({ ...ref, account: b }));
});
