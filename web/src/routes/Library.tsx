import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useReading } from '../reading';
import { bookKey, bookPath, combineBooks, parseSort, sortBooks, sortOptions, type LibrarySort } from '../library';
import { queryClient, session, useSession } from '../session';
import { BookCard, Dialog, ErrorNotice, PageHeader } from '../ui';
import styles from '../App.module.css';
import { Icon } from '../Icon';
import { LoadingStatus, Skeleton } from '../Skeleton';
import { RecentBooks } from '../RecentBooks';
import { Button } from '../Controls';

export function Library() {
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
  const sharedEnabled = access.kind === 'authenticated';
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
      const books: Awaited<ReturnType<typeof session.api.documents>>['items'] = [];
      while (page !== null && books.length < 3) {
        const result = await session.api.documents(account!, page, '', 'read', signal, true);
        books.push(...result.items.filter(item => item.file_available).slice(0, 3 - books.length));
        page = result.next_page;
      }
      return books;
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
  const serverRows = reading.books.filter(book => book.ref.kind === 'server');
  const books = sortBooks(combineBooks(serverRows, serverDocuments, account).filter(book => !!book.document), sort);
  const recent = sharedEnabled && !q && resume.data && account
    ? resume.data.flatMap(document => combineBooks(serverRows.filter(book => book.ref.kind === 'server' && book.ref.documentId === document.id), [document], account))
    : [];
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && value !== 'all') next.set(key, value); else next.delete(key);
    setParams(next, { preventScrollReset: true, replace: !!dialog && key !== 'dialog', state: dialog || key === 'dialog' ? { libraryDialog: true } : null });
  };
  const open = (name: string) => update('dialog', name);
  const close = () => {
    if (importing) {
      setImportNotice('Upload cancelled. Check the Library in case it already reached the server.');
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
    if (!selected || access.kind !== 'authenticated') return;
    setImporting(true);
    setError(null); setImportNotice(null);
    const controller = new AbortController();
    importController.current = controller;
    try {
      if (selected.size > 64 * 1024 * 1024) throw new Error('Uploads are limited to 64 MiB.');
      const document = await session.api.uploadDocument(access.account, selected, controller.signal);
      void queryClient.invalidateQueries({ queryKey: ['documents', access.account] });
      if (!controller.signal.aborted) setNewBook(bookPath({ kind: 'server', account: access.account, documentId: document.id }));
    } catch (failure) { if (!controller.signal.aborted) setError(failure); }
    finally {
      setImporting(false);
      importController.current = null;
      if (file.current) file.current.value = '';
    }
  }
  return <>
    <PageHeader title="Library" headingRef={heading}
      actions={reading.pendingCount > 0 && <Link className={styles.pendingSync} to="/settings?sync=open">{reading.pendingCount} pending</Link>} />
    {!reading.ready && !sharedEnabled && <LoadingStatus>Opening your stored library…</LoadingStatus>}
    <RecentBooks books={recent} />
    <form className={styles.searchRow} role="search" onSubmit={(event) => { event.preventDefault(); update('q', input.trim()); }}>
      <div className={styles.search}>
        <button type="submit" className={styles.searchSubmit} aria-label="Search"><Icon name="search" size={17} /></button>
        <label><span className={styles.srOnly}>Search title or author</span><input ref={searchInput} type="search" value={input} maxLength={256} placeholder="Title or author" onChange={(event) => setInput(event.target.value)} /></label>
        {(input || q) && <button type="button" className={styles.searchClear} aria-label="Clear search" onClick={clearSearch}>×</button>}
      </div>
      <button type="button" className={styles.icon} aria-label="Add Book" disabled={access.kind !== 'authenticated' || !!capabilities?.demo_mode} onClick={() => { setNewBook(null); setError(null); open('add'); }}><Icon name="add" /></button>
      <button type="button" className={styles.icon} aria-label="Sort Books" aria-haspopup="dialog" aria-expanded={dialog === 'sort'} onClick={() => open('sort')}><Icon name="sort" /></button>
    </form>
    <div className={styles.divider} />
    <ErrorNotice error={documents.error} />
    {documents.isPending && documents.fetchStatus === 'fetching' && <LoadingStatus>Loading shared books…</LoadingStatus>}
    {!books.length && reading.ready && !documents.isFetching && !(sharedEnabled && hasNextPage) && <p>No matching books. Try another search or add an EPUB.</p>}
    <div className={styles.grid}>
      {books.map((book) => <BookCard key={bookKey(book.ref)} book={book} />)}
      {!books.length && (!reading.ready || documents.isPending && documents.fetchStatus === 'fetching') && Array.from({ length: 6 }, (_, index) => <div key={index} className={styles.card} aria-hidden="true">
        <Skeleton block className={`${styles.cover} ${styles.coverThumbnail}`} />
        <h2 className={styles.cardTitle}><Skeleton width="75%" /></h2>
        <p><Skeleton width="52%" /></p>
      </div>)}
    </div>
    {importNotice && <p role="status">{importNotice}</p>}
    <ErrorNotice error={dialog === 'add' ? null : error} />
    {sharedEnabled && hasNextPage && <div className={styles.loadMore}><Button ref={loadMore} disabled={isFetching} onClick={() => void fetchNextPage({ cancelRefetch: false })}>{documents.isFetchingNextPage ? 'Loading…' : isFetchNextPageError ? 'Retry loading shared books' : 'Load more shared books'}</Button></div>}
    {dialog === 'sort' && <Dialog title="Sort Books" onClose={close}><div className={styles.sortOptions}>
      {sortOptions.map(([value, label]) => <button key={value} type="button" aria-pressed={sort === value} onClick={() => applySort(value)}>
        {label}{sort === value && <Icon name="check" size={17} />}
      </button>)}
    </div></Dialog>}
    {dialog === 'add' && <Dialog title="Add Book" onClose={close}><div className={styles.form}>
      <p>Upload an EPUB to the shared library (up to 64 MiB).</p>
      <input ref={file} type="file" accept=".epub,application/epub+zip" aria-label="Choose EPUB to upload" disabled={importing || access.kind !== 'authenticated' || !!capabilities?.demo_mode} onChange={importFile} />
      {importing && <p role="status">Uploading to the shared library…</p>}
      {newBook && <p role="status">Book is in the shared library. <Link to={newBook}>Open book</Link></p>}
      <ErrorNotice error={error} />
      <Button onClick={close}>{importing ? 'Cancel upload' : 'Done'}</Button>
    </div></Dialog>}
  </>;
}
