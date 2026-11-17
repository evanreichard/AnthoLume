import { useState } from 'react';
import { Dialog } from './ui';
import type { LibraryBook } from './library';
import { filterBooks } from './library';
import styles from './App.module.css';

export type LibraryFilters = { source: string; availability: string };
export function LibraryFiltersDialog({ applied, books, query, offline, sharedAvailable, onApply, onClose }: {
  applied: LibraryFilters; books: LibraryBook[]; query: string; offline: boolean; sharedAvailable: boolean;
  onApply: (filters: LibraryFilters) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(applied);
  const count = filterBooks(books, query, draft.source, draft.availability).length;
  return <Dialog title="Filter books" onClose={onClose}><div className={styles.form}>
    <div><label htmlFor="book-source">Source</label><select id="book-source" value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}>
      <option value="all">All sources</option><option value="local">Local-only</option>{sharedAvailable && <option value="server">Shared library</option>}
    </select></div>
    {!offline && <div><label htmlFor="book-availability">Availability</label><select id="book-availability" value={draft.availability} onChange={(event) => setDraft({ ...draft, availability: event.target.value })}>
      <option value="all">Any availability</option><option value="available">Available offline</option><option value="unavailable">Not stored offline</option>
    </select></div>}
    <p role="status">{count} matching loaded {count === 1 ? 'title' : 'titles'}</p>
    <p>Counts use the {books.length} loaded or stored titles only, with the current search. Unloaded shared pages are not counted.</p>
    <p>Reset changes this draft. Apply updates the library; Cancel or Escape discards changes.</p>
    <div className={styles.actions}>
      <button onClick={() => setDraft({ source: 'all', availability: offline ? 'available' : 'all' })}>Reset filters</button>
      <button className={styles.primary} onClick={() => onApply(draft)}>Apply filters · {count} loaded</button>
      <button onClick={onClose}>Cancel</button>
    </div>
  </div></Dialog>;
}
