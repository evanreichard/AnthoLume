import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useReading } from '../reading';
import { bookKey, bookPath, combineBooks, filterBooks } from '../library';
import { session, useSession } from '../session';
import { LibraryFiltersDialog, type LibraryFilters } from '../LibraryFilters';
import { BookCard, Cover, Dialog, ErrorNotice, Resume } from '../ui';
import styles from '../App.module.css';

export function Library({ offline = false }: { offline?: boolean }) {
  const { access, capabilities } = useSession();
  const reading = useReading();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const focusedLocation = useRef<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const q = (params.get('q') || '').slice(0, 256);
  const source = ['local', 'server'].includes(params.get('source') || '') ? params.get('source')! : 'all';
  const availability = offline ? 'available' : ['available', 'unavailable'].includes(params.get('availability') || '') ? params.get('availability')! : 'all';
  const dialog = params.get('dialog');
  const account = access.kind === 'authenticated' || access.kind === 'expired' ? access.account : null;
  const [input, setInput] = useState(q);
  const [error, setError] = useState<unknown>(null);
  const [importing, setImporting] = useState(false);
  const [newBook, setNewBook] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const importController = useRef<AbortController | null>(null);
  useEffect(() => { setInput(q); }, [q]);
  useEffect(() => {
    if (location.state?.focusLibrary && reading.ready && focusedLocation.current !== location.key) {
      heading.current?.focus();
      focusedLocation.current = location.key;
    }
  }, [location.key, location.state, reading.ready]);
  useEffect(() => () => importController.current?.abort(), []);
  const documents = useInfiniteQuery({
    queryKey: ['documents', account, q],
    enabled: !offline && access.kind === 'authenticated' && source !== 'local',
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => session.api.documents(account!, pageParam, q, signal),
    getNextPageParam: (last) => last.next_page ?? undefined,
  });
  const serverDocuments = documents.data?.pages.flatMap((page) => page.items) || [];
  const loadedBooks = combineBooks(reading.books, serverDocuments, account);
  const books = filterBooks(loadedBooks, q, source, availability);
  const feature = !offline ? books.find((book) => book.stored?.availability === 'available' && book.stored.checkpoint.position !== null) : null;
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value); else next.delete(key);
    setParams(next, { preventScrollReset: true, replace: !!dialog && key !== 'dialog', state: dialog || key === 'dialog' ? { libraryDialog: true } : null });
  };
  const open = (name: string) => update('dialog', name);
  const close = () => {
    if (importing) {
      setImportNotice('Cancelling import… Saved books are retained.');
      importController.current?.abort();
    }
    const next = new URLSearchParams(params);
    next.delete('dialog');
    setParams(next, { replace: true, preventScrollReset: true });
  };
  function applyFilters(filters: LibraryFilters) {
    const next = new URLSearchParams(params);
    next.delete('dialog');
    for (const [key, value] of Object.entries(filters)) {
      if (value === 'all') next.delete(key); else next.set(key, value);
    }
    setParams(next, { replace: true, preventScrollReset: true });
  }
  function clearSearch() {
    setInput('');
    update('q', '');
    searchInput.current?.focus();
  }
  async function importFile(event: FormEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0];
    if (!selected) return;
    setImporting(true);
    setError(null); setImportNotice(null);
    const controller = new AbortController();
    importController.current = controller;
    try {
      const ref = await reading.importLocal(selected, controller.signal);
      if (controller.signal.aborted) return;
      setNewBook(bookPath(ref));
    } catch (failure) { if (!controller.signal.aborted) setError(failure); }
    finally {
      if (controller.signal.aborted) setImportNotice('Import cancelled. Any fully saved book remains available; unfinished work is not published.');
      setImporting(false);
      importController.current = null;
      if (file.current) file.current.value = '';
    }
  }
  return <>
    <div className={styles.pageTitle}><div><p className={styles.eyebrow}>Your collection</p><h1 ref={heading} tabIndex={-1}>{offline ? 'Offline' : 'Library'}</h1></div>{offline && <Link to="/library">Find more books</Link>}</div>
    {!reading.ready && <p role="status">Opening your stored library…</p>}
    {feature && <section className={styles.feature} aria-label="Continue reading"><Cover book={feature} /><div><p className={styles.eyebrow}>Pick up where you left off</p><h2><Link to={bookPath(feature.ref)}>{feature.title || 'Untitled'}</Link></h2><p>{feature.author || 'Unknown author'}</p><Resume book={feature.ref} /></div></section>}
    <form className={styles.searchRow} role="search" onSubmit={(event) => { event.preventDefault(); update('q', input.trim()); }}>
      <div className={styles.search}><label><span className={styles.srOnly}>Search title or author</span><input ref={searchInput} type="search" value={input} maxLength={256} placeholder="Search title or author" onChange={(event) => setInput(event.target.value)} /></label>
        {(input || q) && <button type="button" className={styles.searchClear} aria-label="Clear search" onClick={clearSearch}>×</button>}
      </div>
      <button type="submit" className={styles.icon} aria-label="Search">⌕</button>
      <button type="button" className={styles.icon} aria-label="Add book" disabled={!reading.ready} onClick={() => { setNewBook(null); setError(null); open('add'); }}>＋</button>
      <button type="button" className={styles.icon} aria-label="Filter books" aria-haspopup="dialog" aria-expanded={dialog === 'filter'} onClick={() => open('filter')}>☷</button>
    </form>
    <div className={styles.divider} />
    <p className={styles.resultCount} role="status">{books.length} shown{!offline && source !== 'local' && documents.data ? ` · ${documents.data.pages[0].total} shared matches` : ''}{q ? ` for “${q}”` : ''}</p>
    {access.kind === 'expired' && <p className={styles.notice}>Showing retained books. Sign in to search the live shared library.</p>}
    {access.kind === 'anonymous' && !books.length && <p className={styles.notice}><Link to="/login">Sign in</Link> for the shared library, or add a local EPUB without an account.</p>}
    <ErrorNotice error={documents.error} />
    {documents.isPending && documents.fetchStatus === 'fetching' && <p role="status">Loading shared books…</p>}
    {!books.length && reading.ready && <p>No matching books. {offline ? 'Download a shared book or import a local EPUB to read offline.' : 'Try another search, clear filters, or add a local EPUB.'}</p>}
    <div className={styles.grid}>{books.map((book) => <BookCard key={bookKey(book.ref)} book={book}>{offline && <div className={styles.actions}><Resume book={book.ref} /><Link to={bookPath(book.ref)}>Manage offline copy</Link></div>}</BookCard>)}</div>
    {importNotice && <p role="status">{importNotice}</p>}
    <ErrorNotice error={dialog === 'add' ? null : error} />
    {!offline && source !== 'local' && documents.hasNextPage && <button className={styles.loadMore} disabled={documents.isFetchingNextPage} onClick={() => void documents.fetchNextPage()}> {documents.isFetchingNextPage ? 'Loading…' : 'Load more shared books'}</button>}
    {offline && <section className={styles.panel}><h2>Storage & downloads</h2><p>Removing a shared download keeps its unsent reading events. Removing a local-only book deletes its local copy; it was never uploaded.</p>{reading.downloads.map((download) => <p role="status" key={bookKey(download.ref)}>Downloading: {Math.round(download.receivedBytes / 1024)} KB{download.totalBytes !== null ? ` / ${Math.round(download.totalBytes / 1024)} KB` : ''}</p>)}<Link to="/sync">Synchronization details</Link></section>}
    {dialog === 'filter' && <LibraryFiltersDialog key={JSON.stringify([source, availability, q, account])} applied={{ source, availability }} books={loadedBooks} query={q} offline={offline} sharedAvailable={!!account} onApply={applyFilters} onClose={close} />}
    {dialog === 'add' && <Dialog title="Add a book" onClose={close}><div className={styles.form}>
      <p>Import an EPUB on this device. Local books stay local and never send reading activity to the server.</p>
      <input ref={file} type="file" accept=".epub,application/epub+zip" aria-label="Choose local EPUB" disabled={importing || !reading.ready} onChange={importFile} />
      {importing && <p role="status">Validating and storing the complete book…</p>}
      {newBook && <p role="status">Book saved. <Link to={newBook}>Open book</Link></p>}
      <ErrorNotice error={error} />
      <hr /><a href="/documents">Upload to shared library / manage metadata ↗ (original site)</a>
      {capabilities?.search_enabled && <a href="/search">Find and acquire books ↗ (original site)</a>}
      <button onClick={close}>{importing ? 'Cancel import' : 'Done'}</button>
    </div></Dialog>}
  </>;
}
