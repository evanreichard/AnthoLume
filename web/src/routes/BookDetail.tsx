import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { useReading } from '../reading';
import { bookKey, combineBooks } from '../library';
import { queryClient, session, useSession } from '../session';
import { BookHero, Dialog, ErrorNotice, missingFileLabel, PageHeader } from '../ui';
import { Icon } from '../Icon';
import { OfflinePin } from '../OfflinePin';
import { BookEditor } from './BookEditor';
import { IdentifyBook } from './IdentifyBook';
import { useBookRef } from './bookRef';
import styles from '../App.module.css';
import { BackPill, JoinedAction, JoinedActions, JoinedActionLink, Button } from '../Controls';

function duration(seconds: number) {
  if (!seconds) return '0 min';
  if (seconds < 60) return '< 1 min';
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

function languageName(language: string) {
  try { return new Intl.DisplayNames(undefined, { type: 'language' }).of(language) ?? language; }
  catch { return language; }
}

export function BookDetail() {
  const ref = useBookRef();
  return <BookDetailContent key={ref ? bookKey(ref) : 'unavailable'} />;
}

function BookDetailContent() {
  const ref = useBookRef();
  const reading = useReading();
  const { access, capabilities } = useSession();
  const navigate = useNavigate();
  const librarySearch = useLocation().state?.librarySearch;
  const library = typeof librarySearch === 'string' && librarySearch ? `/library?${librarySearch}` : '/library';
  const [management, setManagement] = useState<'edit' | 'identify' | 'delete' | 'info' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const deleteController = useRef<AbortController | null>(null);
  useEffect(() => () => deleteController.current?.abort(), []);
  const heading = useRef<HTMLHeadingElement>(null);
  const document = useQuery({
    queryKey: ['document', ref],
    enabled: ref?.kind === 'server' && access.kind === 'authenticated',
    queryFn: ({ signal }) => {
      if (ref?.kind !== 'server') throw new Error('Invalid book');
      return session.api.document(ref.account, ref.documentId, signal);
    },
  });
  const state = useQuery({
    queryKey: ['reading-state', ref],
    enabled: ref?.kind === 'server' && access.kind === 'authenticated',
    queryFn: ({ signal }) => {
      if (ref?.kind !== 'server') throw new Error('Invalid book');
      return session.api.bridge.getState(ref.account, ref.documentId, signal);
    },
  });
  const stored = ref ? reading.books.find((book) => bookKey(book.ref) === bookKey(ref)) : undefined;
  const book = document.data && ref?.kind === 'server' ? combineBooks(stored ? [stored] : [], [document.data], ref.account).find(item => !!item.document) : undefined;
  if (!ref || ref.kind !== 'server') return <><h1>Book not available</h1><Link to="/library">Return to Library</Link></>;
  if (!book) return <><Link to="/library">← Library</Link><ErrorNotice error={document.error} /><h1 ref={heading} tabIndex={-1}>{document.isPending ? 'Opening book…' : 'Book not available'}</h1></>;
  function refreshManagement() {
    void queryClient.invalidateQueries({ queryKey: ['document', ref] });
    void queryClient.invalidateQueries({ queryKey: ['cover', ref] });
    void queryClient.invalidateQueries({ queryKey: ['documents'] });
    void queryClient.invalidateQueries({ queryKey: ['library-resume'] });
    void queryClient.invalidateQueries({ queryKey: ['insight-activity'] });
    void queryClient.invalidateQueries({ queryKey: ['insight-progress'] });
  }
  async function deleteSharedBook() {
    if (ref?.kind !== 'server' || deleting) return;
    const controller = deleteController.current = new AbortController();
    setDeleting(true); setDeleteError(null);
    try {
      await session.api.deleteDocument(ref.account, ref.documentId, controller.signal);
      refreshManagement();
      navigate('/library', { replace: true, state: { focusLibrary: true } });
    } catch (err) {
      if (!controller.signal.aborted) setDeleteError(err);
    } finally {
      if (!controller.signal.aborted) setDeleting(false);
    }
  }
  const metadata = document.data;
  const fileUnavailable = metadata?.file_available === false;
  const stats = metadata?.reading_stats;
  const checkpoint = stored?.checkpoint ?? state.data;
  const fraction = checkpoint?.fraction ?? 0;
  const started = !!checkpoint?.position || fraction > 0;
  const edition = (book.title || 'Untitled').match(/^(.+?)\s+\/\s+(.+)$/);
  const title = edition?.[1] ?? (book.title || 'Untitled');
  const format = metadata?.media_type === 'application/epub+zip' ? 'EPUB' : null;
  const canManage = ref.kind === 'server' && access.kind === 'authenticated' && !!document.data && !!capabilities && !capabilities.demo_mode;
  return <article className={styles.bookPage}>
    <PageHeader leading={<BackPill to={library}>Library</BackPill>}
      actions={<JoinedActions label="Book actions">
        {metadata?.file_available && <JoinedActionLink reloadDocument download aria-label="Download EPUB" title="Download EPUB" to={`/api/v1/documents/${encodeURIComponent(ref.documentId)}/file`}><Icon name="download" size={18} /></JoinedActionLink>}
        <JoinedAction aria-label="Book information" title="Book information" onClick={() => setManagement('info')}><Icon name="info" size={18} /></JoinedAction>
        <JoinedActionLink aria-label="Activity" title="Activity" to={`/insights/activity?${new URLSearchParams({ document: ref.documentId })}`}><Icon name="insights" size={18} /></JoinedActionLink>
        {canManage && <>
          <JoinedAction aria-label="Identify book" title="Identify book" onClick={() => setManagement('identify')}><Icon name="search" size={18} /></JoinedAction>
          <JoinedAction aria-label="Edit book" title="Edit book" onClick={() => setManagement('edit')}><Icon name="edit" size={18} /></JoinedAction>
          <JoinedAction tone="danger" aria-label="Delete from shared library" title="Delete from shared library" onClick={() => { setDeleteError(null); setManagement('delete'); }}><Icon name="trash" size={18} /></JoinedAction>
        </>}
      </JoinedActions>} />
    <div className={styles.bookOverview}>
      <BookHero variant="detail" book={{ ...book, title }} headingRef={heading} progress={started ? Math.round(fraction * 100) : null} series={metadata?.series} edition={edition?.[2]}
        action={metadata?.file_available ? (started ? 'Resume' : 'Read') : null} />
      {metadata?.file_available && <OfflinePin book={ref} metadata={book} pinned={!!stored?.pinned} />}
      {fileUnavailable && <div className={styles.bookFileWarning} role="status">
        <Icon name="warning" size={18} />
        <p><strong>{missingFileLabel}</strong> <span>The server can’t find or read this file.</span></p>
      </div>}
    </div>
    <section className={`${styles.detailSection} ${styles.detailReading}`} aria-label="Reading progress">
      <div className={styles.detailProgress}>
        <span>{Math.round(fraction * 100)}%</span><span>{fraction >= 1 ? 'Finished' : started ? 'In progress' : 'Not started'}</span>
        <progress aria-label="Reading progress" max={1} value={fraction} />
      </div>
      {stats && <dl className={styles.detailStats}>
        <div><dt>Time read</dt><dd>{duration(stats.reading_seconds)}</dd></div>
        <div><dt>Reading pace</dt><dd>{stats.words_per_minute ? `${stats.words_per_minute.toLocaleString()} wpm` : '—'}</dd></div>
      </dl>}
    </section>
    <section className={`${styles.detailSection} ${styles.detailInfo}`} aria-label="Book details">
      <dl className={styles.detailMeta}>
        <div><dt>Author</dt><dd>{book.author || 'Unknown'}</dd></div>
        {format && <div><dt>Format</dt><dd>{format}</dd></div>}
        {stats?.word_count != null && stats.word_count > 0 && <div><dt>Length</dt><dd>{stats.word_count.toLocaleString()} words</dd></div>}
        {metadata?.series && <div><dt>Series</dt><dd>{metadata.series}</dd></div>}
        {metadata?.lang && <div><dt>Language</dt><dd>{languageName(metadata.lang)}</dd></div>}
        {metadata?.isbn13 ? <div><dt>ISBN-13</dt><dd>{metadata.isbn13}</dd></div> : metadata?.isbn10 && <div><dt>ISBN-10</dt><dd>{metadata.isbn10}</dd></div>}
      </dl>
      <h2 className={styles.synopsisHeading}>Synopsis</h2>
      <p className={styles.description}>{metadata?.description?.trim() || 'No synopsis available for this edition.'}</p>
    </section>
    {metadata && management === 'info' && <Dialog title="Book information" onClose={() => setManagement(null)} footer={<Button size="slim" onClick={() => setManagement(null)}>Close</Button>}>
      <dl className={styles.bookFileDetails}>
        <div><dt>Title</dt><dd>{book.title || 'Untitled'}</dd></div>
        <div><dt>Author</dt><dd>{book.author || 'Unknown'}</dd></div>
        <div><dt>Catalog ID</dt><dd><code>{metadata.id}</code></dd></div>
        <div><dt>Format</dt><dd>{format ?? metadata.media_type ?? 'Unknown'}</dd></div>
        <div><dt>File size</dt><dd>{metadata.file_size_bytes == null ? 'Unavailable' : `${metadata.file_size_bytes.toLocaleString()} bytes`}</dd></div>
        {metadata.storage_root_id != null && <div><dt>Storage root</dt><dd><code>{metadata.storage_root_id}</code></dd></div>}
        {metadata.relative_file_path != null && <div><dt>Path within storage root</dt><dd><code>{metadata.relative_file_path}</code></dd></div>}
      </dl>
      <p>The catalog ID is used for KOReader sync. For newly imported books, it is the KOReader partial MD5.</p>
    </Dialog>}
    {canManage && document.data && management === 'edit' &&
      <BookEditor book={book} refId={ref} document={document.data} onClose={() => setManagement(null)} onSaved={() => { refreshManagement(); setManagement(null); }} />}
    {canManage && document.data && management === 'identify' &&
      <IdentifyBook refId={ref} document={document.data} onClose={() => setManagement(null)} onSaved={() => { refreshManagement(); setManagement(null); }} />}
    {ref.kind === 'server' && access.kind === 'authenticated' && management === 'delete' && <Dialog title="Delete from shared library?" onClose={() => { if (!deleting) setManagement(null); }}>
      <p>“{title}” will be removed from the shared library for everyone. The server keeps the original file and reading history. This does not remove downloads from other devices.</p>
      <ErrorNotice error={deleteError} />
      <div className={styles.actions}>
        <Button disabled={deleting} onClick={() => setManagement(null)}>Cancel</Button>
        <Button tone="danger" disabled={deleting} onClick={() => void deleteSharedBook()}>{deleting ? 'Deleting…' : 'Delete'}</Button>
      </div>
    </Dialog>}
    <ErrorNotice error={document.error} />
  </article>;
}
