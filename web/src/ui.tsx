import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { BookRef } from './reading';
import { bookKey, bookPath, type LibraryBook } from './library';
import { session, useSession } from './session';
import styles from './App.module.css';
import { Icon } from './Icon';

export function PageHeader({ title, headingRef, actions }: { title: string; headingRef?: Ref<HTMLHeadingElement>; actions?: ReactNode }) {
  return <header className={styles.pageTitle}>
    <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{title}</h1>
    {actions}
  </header>;
}

export function Dialog({ title, children, onClose, className }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.showModal();
    return () => { ref.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} className={[styles.dialog, className].filter(Boolean).join(' ')} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === ref.current) onClose(); }} aria-labelledby="dialog-title">
    <div className={styles.row}><h2 id="dialog-title">{title}</h2><button className={styles.icon} onClick={onClose} aria-label="Close dialog">×</button></div>
    {children}
  </dialog>;
}
const coverHues = [24, 46, 104, 167, 211, 267, 336];

function placeholderHue(ref: BookRef) {
  const key = bookKey(ref);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash, 31) + key.charCodeAt(i) | 0;
  return coverHues[(hash >>> 0) % coverHues.length];
}

export function Cover({ book, sourceId, thumbnail = false }: {
  book: LibraryBook;
  sourceId?: string;
  thumbnail?: boolean;
}) {
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
    enabled: authenticated && !!book.document?.cover_available,
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
  const image = authenticated && book.document ? (book.document.cover_available ? remoteURL || (remote.isError ? localURL : null) : null) : localURL;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const sourceLabel = ref.kind === 'local' ? 'Local-only book' : 'Shared library book';
  return <div className={thumbnail ? `${styles.cover} ${styles.coverThumbnail}` : styles.cover}>
    {image && image !== failedImage ? (
      <img key={image} src={image} alt="" onError={() => setFailedImage(image)} />
    ) : (
      <div className={styles.coverPlaceholder} style={{ '--cover-hue': placeholderHue(ref) } as CSSProperties} aria-hidden="true">
        <div className={styles.coverImprint}>
          <Icon name="book" size={18} />
          <span className={styles.coverTitle}>{book.title || 'Untitled'}</span>
          {book.author && <span className={styles.coverAuthor}>{book.author}</span>}
        </div>
      </div>
    )}
    <div className={styles.coverBadges}>
      <span id={sourceId} className={styles.provenance} role="img" aria-label={sourceLabel} title={sourceLabel}><Icon name={ref.kind === 'local' ? 'device' : 'cloud'} size={14} /></span>
    </div>
  </div>;
}
export function BookCard({ book, children }: { book: LibraryBook; children?: ReactNode }) {
  const id = useId();
  return <article className={styles.card}>
    <Link to={bookPath(book.ref)} className={styles.bookLink} aria-labelledby={`${id}-source ${id}-title ${id}-author`}>
      <Cover book={book} thumbnail sourceId={`${id}-source`} />
      <div>
        <h2 id={`${id}-title`} className={styles.cardTitle}>{book.title || 'Untitled'}</h2>
        <p id={`${id}-author`}>{book.author || 'Unknown author'}</p>
      </div>
    </Link>
    {children}
  </article>;
}
export function Resume({ book, children = 'Resume' }: { book: BookRef; children?: ReactNode }) {
  return <Link className={styles.primary} to={bookPath(book, 'read')}><Icon name="book" size={17} />{children}</Link>;
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? <p role="alert" className={styles.error}>{error instanceof Error ? error.message : String(error)}</p> : null;
}
