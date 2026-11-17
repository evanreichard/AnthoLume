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
export function filterBooks(books: LibraryBook[], q: string, source: string, availability: string) {
  const search = q.toLocaleLowerCase();
  return books.filter((book) => (!search || `${book.title ?? ''}\n${book.author ?? ''}`.toLocaleLowerCase().includes(search)) && (source === 'all' || book.ref.kind === source) && (availability === 'all' || (book.stored?.availability === 'available' ? 'available' : 'unavailable') === availability));
}
