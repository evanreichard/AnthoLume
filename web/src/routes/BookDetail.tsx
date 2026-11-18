import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useReading } from '../reading';
import { bookKey, combineBooks } from '../library';
import { queryClient, session, useSession } from '../session';
import { Cover, Dialog, ErrorNotice, Resume } from '../ui';
import { Icon } from '../Icon';
import { BookEditor } from './BookEditor';
import { useBookRef } from './bookRef';
import styles from '../App.module.css';

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
  const [error, setError] = useState<unknown>(null);
  const [removing, setRemoving] = useState(false);
  const [management, setManagement] = useState<'edit' | 'delete' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState(false);
  const [removingBusy, setRemovingBusy] = useState(false);
  const [focusAfterAction, setFocusAfterAction] = useState<'download' | 'remove' | 'cancel' | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const downloadController = useRef<AbortController | null>(null);
  const deleteController = useRef<AbortController | null>(null);
  useEffect(() => () => { downloadController.current?.abort(); deleteController.current?.abort(); }, []);
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
  const activeDownload = ref ? reading.downloads.find((download) => bookKey(download.ref) === bookKey(ref)) : undefined;
  const book = combineBooks(stored ? [stored] : [], document.data ? [document.data] : [], ref?.kind === 'server' ? ref.account : null)[0];
  useEffect(() => {
    const projected = focusAfterAction === 'download' ? stored?.availability === 'available' : focusAfterAction === 'remove' ? stored?.availability !== 'available' : true;
    if (focusAfterAction && !removing && projected && heading.current) {
      heading.current.focus();
      setFocusAfterAction(null);
    }
  }, [focusAfterAction, removing, stored?.availability]);
  if (!ref) return <><h1 ref={heading} tabIndex={-1}>Book not available</h1><p>This account cannot access that book. Local books are still available.</p><Link to="/library">Return to Library</Link></>;
  if (!book) return <><Link to="/library">← Library</Link><ErrorNotice error={document.error} /><h1 ref={heading} tabIndex={-1}>{document.isFetching || !reading.ready ? 'Opening book…' : 'Book not stored on this device'}</h1></>;
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
  async function download() {
    if (!document.data) return;
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true); setCancelling(false); setError(null); setDownloadNotice(null);
    try {
      await reading.download(document.data, controller.signal);
      if (!controller.signal.aborted) setFocusAfterAction('download');
    } catch (failure) { if (!controller.signal.aborted) setError(failure); }
    finally {
      if (controller.signal.aborted) {
        setDownloadNotice('Download cancelled. Any fully saved copy is retained; unfinished work is not available offline.');
        setFocusAfterAction('cancel');
      }
      downloadController.current = null;
      setDownloading(false); setCancelling(false);
    }
  }
  async function remove() {
    if (!ref) return;
    setError(null);
    setRemovingBusy(true);
    try {
      await reading.removeBook(ref);
      setRemoving(false);
      if (ref.kind === 'local') navigate('/library', { replace: true, state: { focusLibrary: true } });
      else setFocusAfterAction('remove');
    } catch (failure) { setError(failure); }
    finally { setRemovingBusy(false); }
  }
  const metadata = document.data;
  const stats = metadata?.reading_stats;
  const checkpoint = stored?.checkpoint ?? state.data;
  const fraction = checkpoint?.fraction ?? 0;
  const started = !!checkpoint?.position || fraction > 0;
  const edition = (book.title || 'Untitled').match(/^(.+?)\s+\/\s+(.+)$/);
  const title = edition?.[1] ?? (book.title || 'Untitled');
  const offlineEnabled = window.isSecureContext;
  const format = metadata?.media_type === 'application/epub+zip' || ref.kind === 'local' ? 'EPUB' : null;
  const canManage = ref.kind === 'server' && access.kind === 'authenticated' && !!document.data && !!capabilities && !capabilities.demo_mode;
  return <article className={styles.bookPage}>
    <div className={styles.bookTop}>
      <Link className={styles.back} to="/library" onClick={(event) => { if (window.history.state?.idx > 0) { event.preventDefault(); navigate(-1); } }}><Icon name="back" size={17} /> Library</Link>
      {canManage && <div className={styles.bookTopActions} role="group" aria-label="Manage book">
        <button type="button" className={styles.icon} aria-label="Edit book" title="Edit book" onClick={() => setManagement('edit')}><Icon name="edit" size={18} /></button>
        <button type="button" className={`${styles.icon} ${styles.deleteAction}`} aria-label="Delete from shared library" title="Delete from shared library" onClick={() => { setDeleteError(null); setManagement('delete'); }}><Icon name="trash" size={18} /></button>
      </div>}
    </div>
    <header className={styles.detail}>
      <Cover book={{ ...book, title }} />
      <div className={styles.detailCopy}>
        <div className={styles.detailHeading}>
          {metadata?.series && <p className={styles.eyebrow}>{metadata.series}</p>}
          <h1 ref={heading} tabIndex={-1}>{title}</h1>
          <p className={styles.detailAuthor}>{book.author || 'Unknown author'}</p>
          {edition && <p className={styles.detailEdition}>{edition[2]}</p>}
        </div>
        {(stored?.availability === 'available' || metadata?.file_available) && <div className={styles.detailActions}>
          <Resume book={ref}>{started ? 'Resume' : 'Read'}</Resume>
        </div>}
      </div>
    </header>
    <section className={`${styles.detailSection} ${styles.detailReading}`} aria-labelledby="book-reading">
      <div className={styles.detailReadingHeading}>
        <h2 id="book-reading">Your reading</h2>
        {ref.kind === 'server' && <Link to={`/insights/activity?${new URLSearchParams({ document: ref.documentId })}`}>View activity</Link>}
      </div>
      <div className={styles.detailProgress}>
        <span>{Math.round(fraction * 100)}%</span><span>{fraction >= 1 ? 'Finished' : started ? 'In progress' : 'Not started'}</span>
        <progress aria-label="Reading progress" max={1} value={fraction} />
      </div>
      {stats && <dl className={styles.detailStats}>
        <div><dt>Time read</dt><dd>{duration(stats.reading_seconds)}</dd></div>
        <div><dt>Reading pace</dt><dd>{stats.words_per_minute ? `${stats.words_per_minute.toLocaleString()} wpm` : '—'}</dd></div>
      </dl>}
    </section>
    <section className={`${styles.detailSection} ${styles.detailInfo}`} aria-labelledby="book-information">
      <h2 id="book-information">Book information</h2>
      <p className={styles.description}>{metadata?.description?.trim() || 'No synopsis available for this edition.'}</p>
      <dl className={styles.detailMeta}>
        <div><dt>Author</dt><dd>{book.author || 'Unknown'}</dd></div>
        {metadata?.series && <div><dt>Series</dt><dd>{metadata.series}</dd></div>}
        {metadata?.lang && <div><dt>Language</dt><dd>{languageName(metadata.lang)}</dd></div>}
        {format && <div><dt>Format</dt><dd>{format}</dd></div>}
        {stats?.word_count != null && stats.word_count > 0 && <div><dt>Length</dt><dd>{stats.word_count.toLocaleString()} words</dd></div>}
      </dl>
    </section>
    <div className={styles.bookTools} aria-label="Book actions">
      {offlineEnabled && ref.kind === 'server' && stored?.availability !== 'available' && metadata?.file_available && !downloading && <button className={styles.downloadAction} onClick={() => void download()} disabled={!reading.ready}><Icon name="download" size={17} /> Download</button>}
      {downloading && <button disabled={cancelling} onClick={() => { setCancelling(true); setDownloadNotice('Cancelling download…'); downloadController.current?.abort(); }}>{cancelling ? 'Cancelling…' : 'Cancel download'}</button>}
      {stored?.availability === 'available' && (offlineEnabled || ref.kind === 'local') && <button disabled={!reading.ready} onClick={() => setRemoving(true)}>{ref.kind === 'local' ? 'Remove local book' : 'Remove offline'}</button>}
    </div>
    {downloading && <p role="status">{activeDownload ? `Downloading · ${Math.round(activeDownload.receivedBytes / 1024)} KB` : 'Preparing download…'}</p>}
    {downloadNotice && <p role="status">{downloadNotice}</p>}
    {ref.kind === 'server' && document.data && access.kind === 'authenticated' && management === 'edit' &&
      <BookEditor book={book} refId={ref} document={document.data} onClose={() => setManagement(null)} onSaved={() => { refreshManagement(); setManagement(null); }} />}
    {ref.kind === 'server' && access.kind === 'authenticated' && management === 'delete' && <Dialog title="Delete from shared library?" onClose={() => { if (!deleting) setManagement(null); }}>
      <p>“{title}” will be removed from the shared library for everyone. The server keeps the original file and reading history. This does not remove downloads from other devices.</p>
      <ErrorNotice error={deleteError} />
      <div className={styles.actions}>
        <button disabled={deleting} onClick={() => setManagement(null)}>Cancel</button>
        <button disabled={deleting} className={styles.deleteAction} onClick={() => void deleteSharedBook()}>{deleting ? 'Deleting…' : 'Delete book'}</button>
      </div>
    </Dialog>}
    <ErrorNotice error={error || document.error} />
    {removing && <Dialog title={ref.kind === 'local' ? 'Remove local book?' : 'Remove offline download?'} onClose={() => { if (!removingBusy) setRemoving(false); }}><div className={styles.form}><p>{ref.kind === 'local' ? 'This deletes the local book and its local reading records. It was never uploaded. Keep the original EPUB if you want to import it again.' : 'The server book and unsent reading events remain. You can download the book again when connected.'}</p><ErrorNotice error={error} /><button disabled={removingBusy} onClick={() => void remove()}>{removingBusy ? 'Removing…' : 'Remove offline'}</button><button disabled={removingBusy} onClick={() => setRemoving(false)}>Keep book</button></div></Dialog>}
  </article>;
}
