import { useEffect, useEffectEvent, useId, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ButtonLink } from './Controls';
import { Icon } from './Icon';
import { bookKey, bookPath, type LibraryBook } from './library';
import { readCover, sameAccount, useReading, type BookRef } from './reading';
import { session, useSession } from './session';
import app from './App.module.css';
import styles from './BookPresentation.module.css';
import { useObjectURL } from './useObjectURL';

const coverHues = [24, 46, 104, 167, 211, 267, 336];

function placeholderHue(ref: BookRef) {
  const key = bookKey(ref);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
  return coverHues[(hash >>> 0) % coverHues.length];
}

export const missingFileLabel = 'Book file unavailable';

export function Cover({
  book,
  sourceId,
  warningId,
  thumbnail = false,
}: {
  book: LibraryBook;
  sourceId?: string;
  warningId?: string;
  thumbnail?: boolean;
}) {
  const { access } = useSession();
  const { cacheCover, deviceCopies, ready } = useReading();
  const cover = book.stored?.cover;
  const ref = book.ref;
  const authenticated =
    access.kind === 'authenticated' && ref.kind === 'server' && sameAccount(access.account, ref.account);
  const remote = useQuery({
    queryKey: ['cover', ref],
    enabled: authenticated && !!book.document?.cover_available,
    queryFn: async ({ signal }) => {
      if (ref.kind !== 'server') throw new Error('Not a server book');
      return readCover(await session.api.bridge.fetchCover(ref.account, ref.documentId, signal), signal);
    },
  });
  const storeCover = useEffectEvent((blob: Blob) => {
    if (ref.kind === 'server') void cacheCover(ref, blob);
  });
  const canBackfill =
    authenticated && ready && !!book.document?.cover_available && deviceCopies?.has(ref.documentId) && !cover;
  const key = bookKey(ref);
  useEffect(() => {
    if (canBackfill && remote.data) storeCover(remote.data);
  }, [canBackfill, key, remote.data]);
  const image = useObjectURL(
    authenticated && book.document
      ? book.document.cover_available
        ? (remote.data ?? (remote.isError ? cover : undefined))
        : undefined
      : cover,
  );
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const sourceLabel = ref.kind === 'local' ? 'Local-only book' : 'Shared library book';
  return (
    <div className={thumbnail ? `${styles.cover} ${styles.coverThumbnail}` : styles.cover}>
      {image && image !== failedImage ? (
        <img key={image} src={image} alt="" onError={() => setFailedImage(image)} />
      ) : (
        <div
          className={styles.coverPlaceholder}
          style={{ '--cover-hue': placeholderHue(ref) } as CSSProperties}
          aria-hidden="true"
        >
          <div className={styles.coverImprint}>
            <Icon name="book" size={18} />
            <span className={styles.coverTitle}>{book.title || 'Untitled'}</span>
            {book.author && <span className={styles.coverAuthor}>{book.author}</span>}
          </div>
        </div>
      )}
      {warningId && book.document?.file_available === false && (
        <span
          id={warningId}
          className={styles.coverWarning}
          role="img"
          aria-label={missingFileLabel}
          title={missingFileLabel}
        >
          <Icon name="warning" size={17} />
        </span>
      )}
      <div className={styles.coverBadges}>
        <span id={sourceId} className={styles.provenance} role="img" aria-label={sourceLabel} title={sourceLabel}>
          <Icon name={ref.kind === 'local' ? 'device' : 'cloud'} size={14} />
        </span>
        {ref.kind === 'server' && deviceCopies?.get(ref.documentId) === 'saved' && (
          <span role="img" aria-label="Saved to device" title="Saved to device">
            <Icon name="kept" size={16} />
          </span>
        )}
      </div>
    </div>
  );
}

type BookHeroProps = { book: LibraryBook; progress: number | null } & (
  | { variant: 'continue'; embedded?: boolean; linkState?: { librarySearch: string } }
  | {
      variant: 'detail';
      headingRef: Ref<HTMLHeadingElement>;
      series?: string | null;
      edition?: string;
      action: 'Read' | 'Resume' | null;
    }
);

export function BookHero(props: BookHeroProps) {
  const id = useId();
  const { book, variant, progress } = props;
  const title = book.title || 'Untitled';
  const detail = variant === 'detail';
  const author = book.author || (detail ? 'Unknown author' : '');
  const eyebrow = detail ? props.series : 'Continue reading';
  const action = detail ? props.action : 'Resume';
  return (
    <section
      className={detail ? `${styles.feature} ${styles.bookHeroDetail}` : styles.feature}
      data-embedded={(!detail && props.embedded) || undefined}
      aria-label={detail ? undefined : 'Continue reading'}
      aria-labelledby={detail ? id : undefined}
    >
      <div className={styles.featureCopy}>
        {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
        <div className={styles.heroMetadata}>
          {detail ? (
            <h1 className={styles.heroTitle} id={id} ref={props.headingRef} tabIndex={-1}>
              {title}
            </h1>
          ) : (
            <h2 className={styles.heroTitle}>
              <Link to={bookPath(book.ref)} state={props.linkState}>
                {title}
              </Link>
            </h2>
          )}
          {author && <p>{author}</p>}
          {detail && props.edition && <p className={styles.heroEdition}>{props.edition}</p>}
        </div>
        {!detail && progress !== null && <span className={app.srOnly}>{progress}% read</span>}
        {action && <Resume book={book.ref}>{action}</Resume>}
      </div>
      <div className={styles.featureCover}>
        <Cover book={book} />
      </div>
      {progress !== null && (
        <span className={styles.featureMark} aria-hidden="true">
          {progress}
          <small>%</small>
        </span>
      )}
    </section>
  );
}

export function BookCard({
  book,
  children,
  linkState,
  action = 'books',
}: {
  book: LibraryBook;
  children?: ReactNode;
  action?: 'books' | 'read';
  linkState?: { librarySearch: string };
}) {
  const id = useId();
  return (
    <article className={styles.card}>
      <Link
        to={bookPath(book.ref, action)}
        state={linkState}
        className={styles.bookLink}
        aria-labelledby={`${id}-source ${id}-title ${id}-author`}
        aria-describedby={book.document?.file_available === false ? `${id}-warning` : undefined}
      >
        <Cover book={book} thumbnail sourceId={`${id}-source`} warningId={`${id}-warning`} />
        <div>
          <h2 id={`${id}-title`} className={styles.cardTitle}>
            {book.title || 'Untitled'}
          </h2>
          <p id={`${id}-author`}>{book.author || 'Unknown author'}</p>
        </div>
      </Link>
      {children}
    </article>
  );
}

function Resume({ book, children = 'Resume' }: { book: BookRef; children?: ReactNode }) {
  return (
    <ButtonLink tone="primary" to={bookPath(book, 'read')}>
      <Icon name="book" size={17} />
      {children}
    </ButtonLink>
  );
}
