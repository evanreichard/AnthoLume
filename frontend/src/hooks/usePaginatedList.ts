import { useEffect, useState } from 'react';

/**
 * Page state for a paginated list. Passing `resetKey` (e.g. a search term or filter id) resets
 * back to page 1 whenever it changes, so a filter change never strands the user on a now-empty page.
 */
export function usePaginatedList(resetKey?: unknown) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  return { page, setPage };
}
