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
  const [management, setManagement] = useState<'edit' | 'delete' | null>(null);
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
  const stats = metadata?.reading_stats;
  const checkpoint = stored?.checkpoint ?? state.data;
  const fraction = checkpoint?.fraction ?? 0;
  const started = !!checkpoint?.position || fraction > 0;
  const edition = (book.title || 'Untitled').match(/^(.+?)\s+\/\s+(.+)$/);
  const title = edition?.[1] ?? (book.title || 'Untitled');
  const format = metadata?.media_type === 'application/epub+zip' ? 'EPUB' : null;
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
        {metadata?.file_available && <div className={styles.detailActions}>
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
    <ErrorNotice error={document.error} />
  </article>;
}
