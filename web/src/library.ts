import type { components } from './api/schema.gen';
import type { BookRef, StoredBook } from './reading';

type Document = components['schemas']['Document'];
export type LibraryBook = { ref: BookRef; title: string | null; author: string | null; stored?: StoredBook; document?: Document };
export function bookKey(ref: BookRef): string {
  return JSON.stringify(ref.kind === 'local' ? ['local', ref.localId] : ['server', ref.account.origin, ref.account.userId, ref.documentId]);
}
export function bookPath(ref: BookRef, action: 'books' | 'read' = 'books'): string {
  return `/${action}/${ref.kind}/${encodeURIComponent(ref.kind === 'local' ? ref.localId : ref.documentId)}${ref.kind === 'server' ? `?account=${encodeURIComponent(ref.account.userId)}&origin=${encodeURIComponent(ref.account.origin)}` : ''}`;
}
export function combineBooks(stored: readonly StoredBook[], documents: readonly Document[], account: { origin: string; userId: string } | null): LibraryBook[] {
  const books = new Map<string, LibraryBook>();
  for (const book of stored) {
    if (book.ref.kind === 'server' && (!account || book.ref.account.origin !== account.origin || book.ref.account.userId !== account.userId)) continue;
    books.set(bookKey(book.ref), { ref: book.ref, title: book.title, author: book.author, stored: book });
  }
  if (account) for (const document of documents) {
    const ref: BookRef = { kind: 'server', account, documentId: document.id };
    const key = bookKey(ref);
    books.set(key, { ...books.get(key), ref, title: document.title, author: document.author, document });
  }
  return [...books.values()];
}
export const sortOptions = [['title', 'Title A–Z'], ['author', 'Author A–Z'], ['added', 'Recently added'], ['read', 'Last read']] as const;
export type LibrarySort = typeof sortOptions[number][0];
export function parseSort(value: string | null): LibrarySort {
  return sortOptions.find(([key]) => key === value)?.[0] ?? 'read';
}

const trim = (value: string | null) => (value ?? '').replace(/^ +| +$/g, '');
const asciiFold = (value: string) => value.replace(/[A-Z]/g, char => char.toLowerCase());
function compareText(a: string, b: string) {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const diff = left[i]!.codePointAt(0)! - right[i]!.codePointAt(0)!;
    if (diff) return diff;
  }
  return left.length - right.length;
}
function compareName(a: string | null, b: string | null) {
  const left = asciiFold(trim(a)), right = asciiFold(trim(b));
  return Number(!left) - Number(!right) || compareText(left, right);
}
function time(value?: string) { return value ? Date.parse(value) : -Infinity; }
export function lastRead(book: LibraryBook) {
  return Math.max(time(book.document?.last_read_at), time(book.stored?.lastReadAt));
}
export function sortBooks(books: LibraryBook[], sort: LibrarySort) {
  const added = (book: LibraryBook) => time(book.document ? book.document.added_at : book.stored?.addedAt);
  const read = (book: LibraryBook) => book.document ? time(book.document.last_read_at) : lastRead(book);
  const id = (book: LibraryBook) => book.ref.kind === 'local' ? book.ref.localId : book.ref.documentId;
  return [...books].sort((a, b) => {
    const primary = sort === 'author' ? compareName(a.author, b.author) : sort === 'added' ? added(b) - added(a) : sort === 'read' ? read(b) - read(a) : 0;
    return primary || compareName(a.title, b.title) || compareText(id(a), id(b));
  });
}
export function matchesBook(book: LibraryBook, q: string) {
  const search = q.toLocaleLowerCase();
  return !search || [book.title, book.author].some(value => value?.toLocaleLowerCase().includes(search));
}
