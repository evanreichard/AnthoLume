import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { useReading } from '../reading';
import { bookKey, combineBooks } from '../library';
import { queryClient, session, useSession } from '../session';
import { BookHero, missingFileLabel } from '../BookPresentation';
import { Dialog, ErrorNotice, PageHeader } from '../ui';
import { Icon } from '../Icon';
import { ReviewSourcePill } from '../CandidatePicker';
import type { components } from '../api/schema.gen';
import { DownloadRemovalDialog, useBookDownload } from '../BookDownloadActions';
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
  const { access } = useSession();
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector('button')?.focus({ preventScroll: true });
    function dismiss(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !menu.current?.contains(target) && !more.current?.contains(target)) setMenuOpen(false);
    }
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [menuOpen]);
  const navigate = useNavigate();
  const librarySearch = useLocation().state?.librarySearch;
  const library = typeof librarySearch === 'string' && librarySearch ? `/library?${librarySearch}` : '/library';
  const [management, setManagement] = useState<'edit' | 'identify' | 'delete' | 'info' | { source: components['schemas']['DocumentMatch'] } | null>(null);
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
  const download = useBookDownload(ref?.kind === 'server' ? ref : null, !!document.data?.file_available);
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
  async function metadataSaved(updated: { title: string | null; author: string | null }, cover?: Blob | null) {
    if (ref?.kind === 'server') await reading.updateDownloadMetadata(ref, { title: updated.title, author: updated.author }, cover);
    refreshManagement();
    setManagement(null);
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
  const canManage = ref.kind === 'server' && access.kind === 'authenticated' && !!document.data;
  const saved = download.copy === 'saved';
  const removeCopy = saved || (!!download.copy && fileUnavailable);
  const deviceLabel = saved ? 'Saved' : removeCopy ? 'Remove' : download.busy ? 'Saving' : 'Save';
  function closeMenu() {
    setMenuOpen(false);
    more.current?.focus({ preventScroll: true });
  }
  function openManagement(action: NonNullable<typeof management>) {
    closeMenu();
    if (action === 'delete') setDeleteError(null);
    setManagement(action);
  }
  return <article className={styles.bookPage}>
    <PageHeader leading={<BackPill to={library}>Library</BackPill>}
      actions={<div className={styles.bookActions}
        onBlur={event => { if (menuOpen && event.relatedTarget && event.relatedTarget !== more.current && !menu.current?.contains(event.relatedTarget)) setMenuOpen(false); }}
        onKeyDown={event => { if (menuOpen && event.key === 'Escape') { event.preventDefault(); closeMenu(); } }}>
        <JoinedActions label="Book actions" className={styles.bookToolbar}>
          {(metadata?.file_available || download.copy) && <JoinedAction aria-label={deviceLabel} title={deviceLabel} aria-description={removeCopy ? 'Remove the offline copy from this device' : 'Save for offline reading'} aria-haspopup={removeCopy ? 'dialog' : undefined} aria-disabled={download.disabled || undefined} aria-busy={download.busy || undefined}
            onClick={event => {
              if (download.disabled) return;
              if (removeCopy) { event.currentTarget.focus(); download.askToRemove(); }
              else download.save(book);
            }}><Icon name={saved ? 'device-saved' : 'device'} size={20} /></JoinedAction>}
          <JoinedActionLink aria-label="Activity" title="Activity" to={`/insights/activity?${new URLSearchParams({ document: ref.documentId })}`}><Icon name="insights" size={18} /></JoinedActionLink>
          <JoinedAction ref={more} aria-label="More" title="More" aria-expanded={menuOpen} aria-controls={menuId} onClick={() => { if (menuOpen) closeMenu(); else setMenuOpen(true); }}><Icon name="more" size={20} /></JoinedAction>
        </JoinedActions>
        <div ref={menu} id={menuId} className={styles.bookActionMenu} role="group" aria-label="More actions" hidden={!menuOpen}>
          <button type="button" aria-haspopup="dialog" onClick={() => openManagement('info')}><Icon name="info" size={18} />Info</button>
          {metadata?.file_available && <Link reloadDocument download to={`/api/v1/documents/${encodeURIComponent(ref.documentId)}/file`} onClick={closeMenu}><Icon name="download" size={18} />Export</Link>}
          {canManage && <>
            <hr />
            <button type="button" aria-haspopup="dialog" onClick={() => openManagement('identify')}><Icon name="search" size={18} />Identify</button>
            <button type="button" aria-haspopup="dialog" onClick={() => openManagement('edit')}><Icon name="edit" size={18} />Edit</button>
            <hr />
            <button type="button" aria-haspopup="dialog" className={styles.bookActionDelete} onClick={() => openManagement('delete')}><Icon name="trash" size={18} />Delete</button>
          </>}
        </div>
      </div>} />
    <div className={styles.bookOverview}>
      <BookHero variant="detail" book={{ ...book, title }} headingRef={heading} progress={started ? Math.round(fraction * 100) : null} series={metadata?.series} edition={edition?.[2]}
        action={metadata?.file_available ? (started ? 'Resume' : 'Read') : null} />
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
        {!!metadata?.matches?.length && <div className={styles.detailSources}><dt>Sources</dt><dd>
          {metadata.matches.map(source => <ReviewSourcePill key={source.provider} provider={source.provider} workId={source.work_id}
            disabled={!canManage} onReview={() => setManagement({ source })} />)}
        </dd></div>}
        {metadata?.series && <div><dt>Series</dt><dd>{metadata.series}</dd></div>}
        {metadata?.lang && <div><dt>Language</dt><dd>{languageName(metadata.lang)}</dd></div>}
        {metadata?.isbn13 ? <div><dt>ISBN-13</dt><dd>{metadata.isbn13}</dd></div> : metadata?.isbn10 && <div><dt>ISBN-10</dt><dd>{metadata.isbn10}</dd></div>}
        <div className={styles.detailSynopsis}><dt>Synopsis</dt><dd>{metadata?.description?.trim() || 'No synopsis available for this edition.'}</dd></div>
      </dl>
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
      <BookEditor book={book} refId={ref} document={document.data} onClose={() => setManagement(null)} onSaved={metadataSaved} />}
    {canManage && document.data && (management === 'identify' || (management && typeof management === 'object')) &&
      <IdentifyBook refId={ref} document={document.data} source={management === 'identify' ? undefined : management.source}
        onClose={() => setManagement(null)} onSaved={metadataSaved} />}
    <DownloadRemovalDialog download={download} />
    {canManage && management === 'delete' && <Dialog title="Delete from shared library?" onClose={() => { if (!deleting) setManagement(null); }}>
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
