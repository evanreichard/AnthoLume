import { ButtonLink } from './Controls';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useReading, type BookRef } from './reading';
import { bookKey, bookPath, type LibraryBook } from './library';
import { session, useSession } from './session';
import styles from './App.module.css';
import { Icon } from './Icon';

type PageHeaderProps = { actions?: ReactNode; mobileBrand?: boolean } & (
  | { title: string; headingRef?: Ref<HTMLHeadingElement>; leading?: ReactNode }
  | { title?: never; headingRef?: never; leading: ReactNode }
);

export function PageHeader({ title, headingRef, leading, actions, mobileBrand }: PageHeaderProps) {
  return <header className={styles.pageTitle}>
    <div className={styles.pageTitleStart}>
      {mobileBrand && <img className={styles.mobileBrand} src="/assets/icons/mark.svg" width="30" height="30" alt="" />}
      {leading}
      {title && <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{title}</h1>}
    </div>
    {actions}
  </header>;
}

type DialogProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  size?: 'default' | 'wide';
  layout?: 'content' | 'scroll-body';
  placement?: 'center' | 'mobile-sheet';
  toolbar?: ReactNode;
  titleLeading?: ReactNode;
  footer?: ReactNode;
};

export function Dialog({ title, children, onClose, size = 'default', layout = 'content', placement = 'center', toolbar, titleLeading, footer }: DialogProps) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const heading = titleRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Give native dialog focus a non-interactive target instead of the first button.
    heading?.setAttribute('autofocus', '');
    dialog?.showModal();
    if (heading && document.activeElement !== heading) heading.focus({ preventScroll: true });
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const heading = <h2 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h2>;
  return <dialog ref={ref} className={styles.dialog} data-size={size} data-layout={layout} data-placement={placement} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === ref.current) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) onClose();
  } }} aria-labelledby={titleId}>
    <header className={styles.dialogHeader}>{titleLeading ? <div className={styles.dialogTitleGroup}>{titleLeading}{heading}</div> : heading}<button type="button" className={styles.icon} onClick={onClose} aria-label="Close dialog">×</button></header>
    {toolbar != null && <div className={styles.dialogToolbar}>{toolbar}</div>}
    {layout === 'scroll-body' ? <div className={styles.dialogBody}>{children}</div> : children}
    {footer != null && <footer className={styles.dialogFooter}>{footer}</footer>}
  </dialog>;
}
const coverHues = [24, 46, 104, 167, 211, 267, 336];

function placeholderHue(ref: BookRef) {
  const key = bookKey(ref);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash, 31) + key.charCodeAt(i) | 0;
  return coverHues[(hash >>> 0) % coverHues.length];
}

export const missingFileLabel = 'Book file unavailable';

export function Cover({ book, sourceId, warningId, thumbnail = false }: {
  book: LibraryBook;
  sourceId?: string;
  warningId?: string;
  thumbnail?: boolean;
}) {
  const { access } = useSession();
  const [localURL, setLocalURL] = useState<string | null>(null);
  const { deviceCopies } = useReading();
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
    {warningId && book.document?.file_available === false && <span id={warningId} className={styles.coverWarning} role="img" aria-label={missingFileLabel} title={missingFileLabel}><Icon name="warning" size={17} /></span>}
    <div className={styles.coverBadges}>
      <span id={sourceId} className={styles.provenance} role="img" aria-label={sourceLabel} title={sourceLabel}><Icon name={ref.kind === 'local' ? 'device' : 'cloud'} size={14} /></span>
      {ref.kind === 'server' && deviceCopies?.get(ref.documentId) === 'saved' && <span role="img" aria-label="Saved to device" title="Saved to device"><Icon name="kept" size={16} /></span>}
    </div>
  </div>;
}
type BookHeroProps = { book: LibraryBook; progress: number | null } & (
  | { variant: 'continue'; linkState?: { librarySearch: string } }
  | { variant: 'detail'; headingRef: Ref<HTMLHeadingElement>; series?: string | null; edition?: string; action: 'Read' | 'Resume' | null }
);

export function BookHero(props: BookHeroProps) {
  const id = useId();
  const { book, variant, progress } = props;
  const title = book.title || 'Untitled';
  const detail = variant === 'detail';
  const author = book.author || (detail ? 'Unknown author' : '');
  const eyebrow = detail ? props.series : 'Continue reading';
  const action = detail ? props.action : 'Resume';
  return <section className={detail ? `${styles.feature} ${styles.bookHeroDetail}` : styles.feature}
    aria-label={detail ? undefined : 'Continue reading'} aria-labelledby={detail ? id : undefined}>
    <div className={styles.featureCopy}>
      {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
      <div className={styles.heroMetadata}>
        {detail ? <h1 className={styles.heroTitle} id={id} ref={props.headingRef} tabIndex={-1}>{title}</h1> : <h2 className={styles.heroTitle}><Link to={bookPath(book.ref)} state={props.linkState}>{title}</Link></h2>}
        {author && <p>{author}</p>}
        {detail && props.edition && <p className={styles.heroEdition}>{props.edition}</p>}
      </div>
      {!detail && progress !== null && <span className={styles.srOnly}>{progress}% read</span>}
      {action && <Resume book={book.ref}>{action}</Resume>}
    </div>
    <div className={styles.featureCover}><Cover book={book} /></div>
    {progress !== null && <span className={styles.featureMark} aria-hidden="true">{progress}<small>%</small></span>}
  </section>;
}

export function BookCard({ book, children, linkState, action = 'books' }: { book: LibraryBook; children?: ReactNode; action?: 'books' | 'read'; linkState?: { librarySearch: string } }) {
  const id = useId();
  return <article className={styles.card}>
    <Link to={bookPath(book.ref, action)} state={linkState} className={styles.bookLink} aria-labelledby={`${id}-source ${id}-title ${id}-author`} aria-describedby={book.document?.file_available === false ? `${id}-warning` : undefined}>
      <Cover book={book} thumbnail sourceId={`${id}-source`} warningId={`${id}-warning`} />
      <div>
        <h2 id={`${id}-title`} className={styles.cardTitle}>{book.title || 'Untitled'}</h2>
        <p id={`${id}-author`}>{book.author || 'Unknown author'}</p>
      </div>
    </Link>
    {children}
  </article>;
}
function Resume({ book, children = 'Resume' }: { book: BookRef; children?: ReactNode }) {
  return <ButtonLink tone="primary" to={bookPath(book, 'read')}><Icon name="book" size={17} />{children}</ButtonLink>;
}
export function ErrorNotice({ error }: { error: unknown }) {
  return error ? <p role="alert" className={styles.error}>{error instanceof Error ? error.message : String(error)}</p> : null;
}
