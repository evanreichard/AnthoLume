import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useReading } from '../reading';
import { bookKey, bookPath, combineBooks, lastRead, matchesBook, parseSort, sortBooks, sortOptions, type LibrarySort } from '../library';
import { queryClient, session, useSession } from '../session';
import { BookCard, Cover, Dialog, ErrorNotice, PageHeader, Resume } from '../ui';
import styles from '../App.module.css';
import { Icon } from '../Icon';

export function Library({ offline = false }: { offline?: boolean }) {
  const { access, capabilities } = useSession();
  const reading = useReading();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const focusedLocation = useRef<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const loadMore = useRef<HTMLButtonElement>(null);
  const q = (params.get('q') || '').slice(0, 256);
  const sort = parseSort(params.get('sort'));
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
  const sharedEnabled = !offline && access.kind === 'authenticated';
  const documents = useInfiniteQuery({
    queryKey: ['documents', account, q, sort],
    enabled: sharedEnabled,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => session.api.documents(account!, pageParam, q, sort, signal),
    getNextPageParam: (last) => last.next_page ?? undefined,
  });
  const resume = useQuery({
    queryKey: ['library-resume', account],
    enabled: sharedEnabled && !q,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      let page: number | null = 1;
      while (page !== null) {
        const result = await session.api.documents(account!, page, '', 'read', signal, true);
        const book = result.items.find(item => item.file_available);
        if (book) return book;
        page = result.next_page;
      }
      return null;
    },
  });
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = documents;
  useEffect(() => {
    const target = loadMore.current;
    if (!target || !sharedEnabled || dialog || !hasNextPage || isFetching || isFetchNextPageError || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void fetchNextPage({ cancelRefetch: false });
    }, { rootMargin: '0px 0px 240px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [sharedEnabled, dialog, hasNextPage, isFetching, isFetchNextPageError, fetchNextPage, account, q, sort]);
  const serverDocuments = sharedEnabled ? documents.data?.pages.flatMap((page) => page.items) ?? [] : [];
  const loadedBooks = combineBooks(reading.books, serverDocuments, account);
  const books = sortBooks(loadedBooks.filter(book => {
    if (offline && book.stored?.availability !== 'available') return false;
    if (sharedEnabled && documents.data && book.ref.kind === 'server') return !!book.document;
    return matchesBook(book, q);
  }), sort);
  const featuredDocument = sharedEnabled ? resume.data : null;
  const candidates = combineBooks(reading.books, featuredDocument ? [featuredDocument] : [], account);
  const feature = offline || q ? null : candidates.filter(book => book.document || (book.stored?.availability === 'available' && book.stored.checkpoint.position))
    .reduce<(typeof loadedBooks)[number] | null>((latest, book) => !latest || lastRead(book) > lastRead(latest) ? book : latest, null);
  const fraction = feature?.stored?.checkpoint.fraction ?? feature?.document?.resume_fraction;
  const progress = fraction == null ? null : Math.round(fraction * 100);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value); else next.delete(key);
    setParams(next, { preventScrollReset: true, replace: !!dialog && key !== 'dialog', state: dialog || key === 'dialog' ? { libraryDialog: true } : null });
  };
  const open = (name: string) => update('dialog', name);
  const close = () => {
    if (importing) {
      setImportNotice(offline ? 'Cancelling import… Saved books are retained.' : 'Upload cancelled. Check the Library in case it already reached the server.');
      importController.current?.abort();
    }
    const next = new URLSearchParams(params);
    next.delete('dialog');
    setParams(next, { replace: true, preventScrollReset: true });
  };
  function applySort(value: LibrarySort) {
    const next = new URLSearchParams(params);
    next.delete('dialog');
    if (value === 'read') next.delete('sort'); else next.set('sort', value);
    setParams(next, { replace: true, preventScrollReset: true });
    if (value !== sort) window.scrollTo(0, 0);
  }
  function clearSearch() {
    setInput('');
    update('q', '');
    searchInput.current?.focus();
  }
  async function importFile(event: FormEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0];
    if (!selected || (!offline && access.kind !== 'authenticated')) return;
    setImporting(true);
    setError(null); setImportNotice(null);
    const controller = new AbortController();
    importController.current = controller;
    try {
      if (offline) {
        const ref = await reading.importLocal(selected, controller.signal);
        if (!controller.signal.aborted) setNewBook(bookPath(ref));
      } else if (access.kind === 'authenticated') {
        if (selected.size > 64 * 1024 * 1024) throw new Error('Uploads are limited to 64 MiB.');
        const document = await session.api.uploadDocument(access.account, selected, controller.signal);
        void queryClient.invalidateQueries({ queryKey: ['documents', access.account] });
        if (!controller.signal.aborted) setNewBook(bookPath({ kind: 'server', account: access.account, documentId: document.id }));
      }
    } catch (failure) { if (!controller.signal.aborted) setError(failure); }
    finally {
      if (controller.signal.aborted && offline) setImportNotice('Import cancelled. Any fully saved book remains available; unfinished work is not published.');
      setImporting(false);
      importController.current = null;
      if (file.current) file.current.value = '';
    }
  }
  return <>
    <PageHeader title={offline ? 'Offline' : 'Library'} headingRef={heading}
      actions={offline ? <Link to="/library">Library</Link> : reading.pendingCount > 0 && <Link className={styles.pendingSync} to="/sync">{reading.pendingCount} pending</Link>} />
    {!reading.ready && <p role="status">Opening your stored library…</p>}
    {feature && <section className={styles.feature} aria-label="Continue reading">
      <div className={styles.featureCopy}>
        <p className={styles.eyebrow}>Continue reading</p>
        <h2><Link to={bookPath(feature.ref)}>{feature.title || 'Untitled'}</Link></h2>
        {feature.author && <p>{feature.author}</p>}
        {progress !== null && <p className={styles.featureProgress}>{progress}% read</p>}
        <Resume book={feature.ref} />
      </div>
      <div className={styles.featureCover}><Cover book={feature} showOffline /></div>
      {progress !== null && <span className={styles.featureMark} aria-hidden="true">{progress}<small>%</small></span>}
    </section>}
    <form className={styles.searchRow} role="search" onSubmit={(event) => { event.preventDefault(); update('q', input.trim()); }}>
      <div className={styles.search}>
        <button type="submit" className={styles.searchSubmit} aria-label="Search"><Icon name="search" size={17} /></button>
        <label><span className={styles.srOnly}>Search title or author</span><input ref={searchInput} type="search" value={input} maxLength={256} placeholder="Title or author" onChange={(event) => setInput(event.target.value)} /></label>
        {(input || q) && <button type="button" className={styles.searchClear} aria-label="Clear search" onClick={clearSearch}>×</button>}
      </div>
      <button type="button" className={styles.icon} aria-label={offline ? 'Import local EPUB' : 'Add book'} disabled={offline ? !reading.ready : access.kind !== 'authenticated' || !!capabilities?.demo_mode} onClick={() => { setNewBook(null); setError(null); open('add'); }}><Icon name="add" /></button>
      <button type="button" className={styles.icon} aria-label="Sort books" aria-haspopup="dialog" aria-expanded={dialog === 'sort'} onClick={() => open('sort')}><Icon name="sort" /></button>
    </form>
    <div className={styles.divider} />
    {access.kind === 'expired' && <p className={styles.notice}>Showing retained books. Sign in to search the live shared library.</p>}
    {access.kind === 'anonymous' && !books.length && <p className={styles.notice}><Link to="/login">Sign in</Link> for the shared library, or add a local EPUB without an account.</p>}
    <ErrorNotice error={documents.error} />
    {documents.isPending && documents.fetchStatus === 'fetching' && <p role="status">Loading shared books…</p>}
    {!books.length && reading.ready && !documents.isFetching && !(sharedEnabled && hasNextPage) && <p>No matching books. {offline ? 'Download a shared book or import a local EPUB to read offline.' : 'Try another search or add a local EPUB.'}</p>}
    <div className={styles.grid}>{books.map((book) => <BookCard key={bookKey(book.ref)} book={book}>{offline && <div className={styles.actions}><Resume book={book.ref} /><Link to={bookPath(book.ref)}>Manage offline copy</Link></div>}</BookCard>)}</div>
    {importNotice && <p role="status">{importNotice}</p>}
    <ErrorNotice error={dialog === 'add' ? null : error} />
    {sharedEnabled && hasNextPage && <button ref={loadMore} className={styles.loadMore} disabled={isFetching} onClick={() => void fetchNextPage({ cancelRefetch: false })}>{documents.isFetchingNextPage ? 'Loading…' : isFetchNextPageError ? 'Retry loading shared books' : 'Load more shared books'}</button>}
    {offline && <section className={styles.panel}><h2>Storage & downloads</h2><p>Removing a shared download keeps its unsent reading events. Removing a local-only book deletes its local copy; it was never uploaded.</p>{reading.downloads.map((download) => <p role="status" key={bookKey(download.ref)}>Downloading: {Math.round(download.receivedBytes / 1024)} KB{download.totalBytes !== null ? ` / ${Math.round(download.totalBytes / 1024)} KB` : ''}</p>)}<Link to="/sync">Synchronization details</Link></section>}
    {dialog === 'sort' && <Dialog title="Sort books" onClose={close}><div className={styles.sortOptions}>
      {sortOptions.map(([value, label]) => <button key={value} type="button" aria-pressed={sort === value} onClick={() => applySort(value)}>
        {label}{sort === value && <Icon name="check" size={17} />}
      </button>)}
    </div></Dialog>}
    {dialog === 'add' && <Dialog title={offline ? 'Import local EPUB' : 'Add a book'} onClose={close}><div className={styles.form}>
      <p>{offline ? 'Import an EPUB on this device only.' : 'Upload an EPUB to the shared library (up to 64 MiB).'}</p>
      <input ref={file} type="file" accept=".epub,application/epub+zip" aria-label={offline ? 'Choose local EPUB' : 'Choose EPUB to upload'} disabled={importing || (offline ? !reading.ready : access.kind !== 'authenticated' || !!capabilities?.demo_mode)} onChange={importFile} />
      {importing && <p role="status">{offline ? 'Validating and storing the complete book…' : 'Uploading to the shared library…'}</p>}
      {newBook && <p role="status">{offline ? 'Book saved.' : 'Book is in the shared library.'} <Link to={newBook}>Open book</Link></p>}
      <ErrorNotice error={error} />
      {!offline && capabilities?.search_enabled && <a href="/search">Find and acquire books ↗ (original site)</a>}
      <button onClick={close}>{importing ? offline ? 'Cancel import' : 'Cancel upload' : 'Done'}</button>
    </div></Dialog>}
  </>;
}
