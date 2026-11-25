import type { components } from './api/schema.gen';
import { refKey, sameAccount, type Account, type BookRef, type StoredBook } from './reading/types';

type Document = components['schemas']['Document'];
export type LibraryBook = { ref: BookRef; title: string | null; author: string | null; stored?: StoredBook; document?: Document };
export function bookKey(ref: BookRef): string {
  return refKey(ref);
}
export function bookPath(ref: BookRef, action: 'books' | 'read' = 'books'): string {
  const params = ref.kind === 'server'
    ? new URLSearchParams({ id: ref.documentId, account: ref.account.userId, origin: ref.account.origin })
    : new URLSearchParams({ id: ref.localId });
  return `/${action}/${ref.kind}?${params}`;
}
export function combineBooks(stored: readonly StoredBook[], documents: readonly Document[], account: Account | null): LibraryBook[] {
  const books = new Map<string, LibraryBook>();
  for (const book of stored) {
    if (book.ref.kind === 'server' && (!account || !sameAccount(book.ref.account, account))) continue;
    books.set(bookKey(book.ref), { ref: book.ref, title: book.title, author: book.author, stored: book });
  }
  if (account) for (const document of documents) {
    const ref: BookRef = { kind: 'server', account, documentId: document.id };
    const key = bookKey(ref);
    books.set(key, { ...books.get(key), ref, title: document.title, author: document.author, document });
  }
  return [...books.values()];
}
export const sortOptions = [['title', 'Title A–Z'], ['author', 'Author A–Z'], ['added', 'Recently Added'], ['read', 'Last Read']] as const;
export type LibrarySort = typeof sortOptions[number][0];
export type MatcherReturn = { account: Account; search: string; pages: number };
export function matcherReturn(value: unknown, account: Account): MatcherReturn | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { account: owner, search, pages } = value as Record<string, unknown>;
  if (typeof search !== 'string' || typeof pages !== 'number' || !Number.isSafeInteger(pages) || pages < 1) return null;
  if (!owner || typeof owner !== 'object' || Array.isArray(owner)) return null;
  const { origin, userId, readingGeneration } = owner as Record<string, unknown>;
  if (typeof origin !== 'string' || typeof userId !== 'string' || !userId ||
    readingGeneration !== undefined && (typeof readingGeneration !== 'string' || !readingGeneration)) return null;
  if (!sameAccount({ origin, userId, readingGeneration }, account)) return null;
  const params = new URLSearchParams(search);
  const safe = new URLSearchParams();
  const q = params.get('q')?.slice(0, 256);
  const sort = parseSort(params.get('sort'));
  if (q) safe.set('q', q);
  if (sort !== 'read') safe.set('sort', sort);
  return { account, search: safe.toString(), pages };
}
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
function lastRead(book: LibraryBook) {
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
