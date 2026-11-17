import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useReading } from '../reading';
import { bookKey, combineBooks } from '../library';
import { session, useSession } from '../session';
import { Availability, Cover, Dialog, ErrorNotice, Resume } from '../ui';
import { useBookRef } from './bookRef';
import styles from '../App.module.css';

export function BookDetail() {
  const ref = useBookRef();
  return <BookDetailContent key={ref ? bookKey(ref) : 'unavailable'} />;
}

function BookDetailContent() {
  const ref = useBookRef();
  const reading = useReading();
  const { access } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [removing, setRemoving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [removingBusy, setRemovingBusy] = useState(false);
  const [focusAfterAction, setFocusAfterAction] = useState<'download' | 'remove' | 'cancel' | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const downloadController = useRef<AbortController | null>(null);
  useEffect(() => () => downloadController.current?.abort(), []);
  const heading = useRef<HTMLHeadingElement>(null);
  const document = useQuery({
    queryKey: ['document', ref],
    enabled: ref?.kind === 'server' && access.kind === 'authenticated',
    queryFn: ({ signal }) => {
      if (ref?.kind !== 'server') throw new Error('Invalid book');
      return session.api.document(ref.account, ref.documentId, signal);
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
  return <>
    <Link className={styles.back} to="/library" onClick={(event) => { if (window.history.state?.idx > 0) { event.preventDefault(); navigate(-1); } }}>← Back to Library</Link>
    <section className={styles.detail}>
      <Cover book={book} />
      <div><p className={styles.eyebrow}>{ref.kind === 'local' ? 'On this device' : 'Shared collection'}</p><h1 ref={heading} tabIndex={-1}>{book.title || 'Untitled'}</h1><p>{book.author || 'Unknown author'}</p><Availability book={book} />
      <div className={styles.actions}>{!downloading && (stored?.availability === 'available' || document.data?.file_available) && <Resume book={ref} />}
      {ref.kind === 'server' && stored?.availability !== 'available' && document.data?.file_available && <button onClick={() => void download()} disabled={downloading || !reading.ready}>{downloading ? 'Downloading…' : 'Download'}</button>}
      {downloading && <button disabled={cancelling} onClick={() => { setCancelling(true); setDownloadNotice('Cancelling download… Saved books are retained.'); downloadController.current?.abort(); }}>{cancelling ? 'Cancelling…' : 'Cancel download'}</button>}
      {stored && <button disabled={!reading.ready} onClick={() => setRemoving(true)}>Remove offline</button>}</div>
      {stored?.checkpoint.fraction !== null && stored?.checkpoint.fraction !== undefined && <p>{Math.round(stored.checkpoint.fraction * 100)}% · saved on this device</p>}
      </div>
    </section>
    {downloading && <p role="status">Downloading and validating before offline availability{activeDownload ? ` · ${Math.round(activeDownload.receivedBytes / 1024)} KB received` : ''}.</p>}
    {downloadNotice && <p role="status">{downloadNotice}</p>}
    <ErrorNotice error={error || document.error} />
    {document.data?.description && <section className={styles.panel}><h2>About this book</h2><p className={styles.description}>{document.data.description}</p></section>}
    {document.data?.series && <p>Series: {document.data.series}</p>}
    {ref.kind === 'server' && <a className={styles.legacyLink} href="/documents">Metadata, edit & delete ↗ (original site)</a>}
    {removing && <Dialog title={ref.kind === 'local' ? 'Remove local book?' : 'Remove offline download?'} onClose={() => { if (!removingBusy) setRemoving(false); }}><div className={styles.form}><p>{ref.kind === 'local' ? 'This deletes the local book and its local reading records. It was never uploaded. Keep the original EPUB if you want to import it again.' : 'The server book and unsent reading events remain. You can download the book again when connected.'}</p><ErrorNotice error={error} /><button disabled={removingBusy} onClick={() => void remove()}>{removingBusy ? 'Removing…' : 'Remove offline'}</button><button disabled={removingBusy} onClick={() => setRemoving(false)}>Keep book</button></div></Dialog>}
  </>;
}
