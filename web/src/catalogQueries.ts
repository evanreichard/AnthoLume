import type { QueryClient } from '@tanstack/react-query';
import { sameAccount, type Account, type BookRef } from './reading/types';

type ServerBook = Extract<BookRef, { kind: 'server' }>;

export function invalidateBook(client: QueryClient, book: ServerBook) {
  return invalidateCatalog(client, book.account, book.documentId);
}

export function invalidateLibraryAvailability(client: QueryClient, account: Account) {
  return invalidateCatalog(client, account);
}

function invalidateCatalog(client: QueryClient, account: Account, documentId?: string) {
  return client.invalidateQueries({ predicate: ({ queryKey: [family, scope] }) => {
    if (!scope || typeof scope !== 'object') return false;
    if (family === 'document' || family === 'cover') {
      const ref = scope as BookRef;
      if (ref.kind !== 'server' || !sameAccount(ref.account, account)) return false;
      return documentId === undefined ? family === 'document' : ref.documentId === documentId;
    }
    const relevant = family === 'documents' || family === 'library-resume' ||
      (documentId !== undefined && (family === 'insight-activity' || family === 'insight-progress'));
    return relevant && sameAccount(scope as Account, account);
  } });
}
