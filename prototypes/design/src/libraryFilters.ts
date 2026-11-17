import type { Book } from './data';

export type LibraryFilters = {
  source: 'all' | 'shared' | 'local';
  availability: 'all' | 'offline' | 'online';
};
export const defaultFilters: LibraryFilters = { source: 'all', availability: 'all' };

export function readFilters(params: URLSearchParams): LibraryFilters {
  const source = params.get('source');
  const availability = params.get('availability');
  return {
    source: source === 'shared' || source === 'local' ? source : 'all',
    availability: availability === 'offline' || availability === 'online' ? availability : 'all',
  };
}

export function libraryQuery(query: string, filters: LibraryFilters) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (filters.source !== 'all') params.set('source', filters.source);
  if (filters.availability !== 'all') params.set('availability', filters.availability);
  return params.toString();
}

export function matchesBook(
  book: Book,
  query: string,
  filters: LibraryFilters,
  downloads: string[],
) {
  const available = book.kind === 'local' || downloads.includes(book.id);
  return (
    (filters.source === 'all' || filters.source === book.kind) &&
    (filters.availability === 'all' || available === (filters.availability === 'offline')) &&
    `${book.title} ${book.author}`.toLowerCase().includes(query.trim().toLowerCase())
  );
}
