import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { BookRef } from './reading';
import { bookPath, type LibraryBook } from './library';
import { session, useSession } from './session';
import styles from './App.module.css';

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.showModal();
    return () => { ref.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.dialog} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === ref.current) onClose(); }} aria-labelledby="dialog-title">
    <div className={styles.row}><h2 id="dialog-title">{title}</h2><button className={styles.icon} onClick={onClose} aria-label="Close dialog">×</button></div>
    {children}
  </dialog>;
}
export function Cover({ book }: { book: LibraryBook }) {
  const { access } = useSession();
  const [localURL, setLocalURL] = useState<string | null>(null);
  const cover = book.stored?.cover;
  useEffect(() => {
    if (!cover) { setLocalURL(null); return; }
    const url = URL.createObjectURL(cover);
    setLocalURL(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);
  const ref = book.ref;
  const authenticated = access.kind === 'authenticated' && ref.kind === 'server' && access.account.userId === ref.account.userId && access.account.origin === ref.account.origin;
  const remote = useQuery({
    queryKey: ['cover', ref],
    enabled: !cover && authenticated && !!book.document?.cover_available,
    queryFn: async ({ signal }) => {
      if (ref.kind !== 'server') throw new Error('Not a server book');
      const response = await session.api.bridge.fetchCover(ref.account, ref.documentId, signal);
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Cover unavailable');
      const length = Number(response.headers.get('content-length'));
      if (length > 8 * 1024 * 1024) { await response.body?.cancel(); throw new Error('Cover too large'); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Cover unavailable');
      const parts: Uint8Array<ArrayBuffer>[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.length;
          if (bytes > 8 * 1024 * 1024) throw new Error('Cover too large');
          parts.push(new Uint8Array(part.value));
        }
      } catch (error) { await reader.cancel(); throw error; }
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return new Blob(parts, { type: response.headers.get('content-type')! });
    },
  });
  const [remoteURL, setRemoteURL] = useState<string | null>(null);
  useEffect(() => {
    if (!remote.data || !authenticated) { setRemoteURL(null); return; }
    const url = URL.createObjectURL(remote.data);
    setRemoteURL(url);
    return () => URL.revokeObjectURL(url);
  }, [remote.data, authenticated]);
  const image = localURL || (authenticated ? remoteURL : null);
  return <div className={styles.cover}>
    {image ? <img src={image} alt="" /> : <span className={styles.coverTitle} aria-hidden="true">{book.title || 'Untitled'}</span>}
    <span className={styles.provenance} role="img" aria-label={ref.kind === 'local' ? 'Local-only book' : 'Shared library book'} title={ref.kind === 'local' ? 'Local-only book' : 'Shared library book'}>{ref.kind === 'local' ? '⌂' : '☁'}</span>
  </div>;
}
export function Availability({ book }: { book: LibraryBook }) {
  return <span className={styles.availability}>{book.stored?.availability === 'available' ? '✓ Available offline' : 'Not stored offline'}</span>;
}
export function BookCard({ book, children }: { book: LibraryBook; children?: ReactNode }) {
  return <article className={styles.card}>
    <Link to={bookPath(book.ref)} className={styles.bookLink}><Cover book={book} /><div><h2>{book.title || 'Untitled'}</h2><p>{book.author || 'Unknown author'}</p></div></Link>
    <Availability book={book} />{children}
  </article>;
}
export function Resume({ book, children = 'Resume' }: { book: BookRef; children?: ReactNode }) {
  return <Link className={styles.primary} to={bookPath(book, 'read')}>{children}</Link>;
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? <p role="alert" className={styles.error}>{error instanceof Error ? error.message : String(error)}</p> : null;
}
