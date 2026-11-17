import { useState } from 'react';
import { useDemo } from './DemoState';
import { sampleParagraphs, type Book } from './data';
import { back, Link, navigate } from './navigation';
import { Badge, Confirm, Cover, Dialog, Icon } from './ui';

export function exportSample(book: Book) {
  const url = URL.createObjectURL(
    new Blob(
      [
        `SYNTHETIC M2 SAMPLE — not an EPUB\n${book.title}\n${book.author}\n\n${sampleParagraphs.join('\n\n')}`,
      ],
      { type: 'text/plain' },
    ),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `synthetic-${book.id}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RemovalDialog({
  book,
  kind,
  onClose,
  onDone,
  focusAfterConfirm,
}: {
  book: Book;
  kind: 'download' | 'local' | 'shared';
  onClose: () => void;
  onDone?: () => void;
  focusAfterConfirm?: () => HTMLElement | null;
}) {
  const { setDownloads, setItems, forgetReaderSession, announce } = useDemo();
  const title =
    kind === 'download'
      ? 'Remove this download?'
      : kind === 'local'
        ? 'Delete this local book?'
        : 'Delete from the shared library?';
  const action =
    kind === 'download'
      ? 'Remove download'
      : kind === 'local'
        ? 'Delete local book'
        : 'Delete shared book';
  return (
    <Confirm
      title={title}
      action={action}
      onClose={onClose}
      focusAfterConfirm={focusAfterConfirm}
      onConfirm={() => {
        if (kind === 'download') setDownloads((current) => current.filter((id) => id !== book.id));
        else {
          forgetReaderSession(book.id);
          setItems((current) => current.filter((item) => item.id !== book.id));
          setDownloads((current) => current.filter((id) => id !== book.id));
        }
        announce(
          `Demo only: ${kind === 'download' ? 'download removed; pending events and shared book kept' : kind === 'local' ? 'local sample deleted; shared library unchanged' : 'shared sample deleted for everyone in this demo'}.`,
        );
        onDone?.();
      }}
    >
      <p>
        <b>{book.title}</b>
      </p>
      {kind === 'download' ? (
        <p>
          Frees the account-linked copy on this device only. The shared book, reading position, and
          pending events are kept. You can download it again.
        </p>
      ) : kind === 'local' ? (
        <>
          <p>
            This browser may hold the only original. The book and its local position will be
            removed; there is no undo. Nothing in the shared library changes.
          </p>
          <button onClick={() => exportSample(book)}>Export synthetic text first</button>
          <p className="small muted">Demo exports a plain-text sample, not a real EPUB backup.</p>
        </>
      ) : (
        <>
          <div className="notice danger-note">
            <b>Affects everyone in the shared library</b>
            <p>
              This is not “Remove download.” The shared record is deleted for all users. Real
              file/tombstone handling remains a separate policy review.
            </p>
          </div>
          <p>Demo account: Alex Rowan · administrator. No real server request will be sent.</p>
        </>
      )}
    </Confirm>
  );
}

export function BookDetail({ book, params }: { book: Book; params: URLSearchParams }) {
  const { downloads, setDownloads, announce } = useDemo();
  const [removal, setRemoval] = useState<'download' | 'local' | 'shared' | null>(null);
  const [downloadDialog, setDownloadDialog] = useState(false);
  const [more, setMore] = useState(false);
  const available = book.kind === 'local' || downloads.includes(book.id);
  const fallback = `/library?${params}`;
  return (
    <section className="detail-panel" aria-label="Book details">
      <button className="back-link" onClick={() => back(fallback)}>
        <Icon name="back" /> Back to results
      </button>
      <div className="detail-visual">
        <Cover book={book} />
        <div className="detail-stamp">
          {book.kind === 'local' ? 'LOCAL\nORIGINAL' : 'SHARED\nLIBRARY'}
          <span>synthetic edition</span>
        </div>
      </div>
      <div className="detail-copy">
        <p className="eyebrow">{book.category} · Synthetic EPUB record</p>
        <h1 tabIndex={-1} data-route-heading>
          {book.title}
        </h1>
        <p className="detail-author">{book.author}</p>
        <div className="detail-badges">
          <Badge tone={available ? 'good' : ''}>
            {book.kind === 'local'
              ? 'Local only · demo'
              : available
                ? 'Available offline · demo'
                : 'Online only · demo'}
          </Badge>
          <Badge>{book.size} · sample</Badge>
        </div>
        <Link className="primary full detail-read" to={`/read/${book.id}`}>
          {book.progress ? 'Resume' : 'Read sample'}
          <Icon name="arrow" />
        </Link>
        <p className="description">{book.description}</p>
        <div className="reading-position">
          <span>
            Resume position <b>{book.progress}%</b>
          </span>
          <div className="progress">
            <span style={{ width: `${book.progress}%` }} />
          </div>
          <small>Illustrative position · not a saved checkpoint</small>
        </div>
        <div className="detail-actions">
          {book.kind === 'shared' &&
            (available ? (
              <button onClick={() => setRemoval('download')}>Remove download</button>
            ) : (
              <button onClick={() => setDownloadDialog(true)}>Simulate download</button>
            ))}
          <button onClick={() => exportSample(book)}>Export sample text</button>
          <button aria-expanded={more} onClick={() => setMore(!more)}>
            More book actions
          </button>
        </div>
        {more && (
          <div className="more-book-actions">
            <p>
              {book.kind === 'local'
                ? 'This browser only. No shared-library effect.'
                : 'Shared-library action · affects all users.'}
            </p>
            <button
              className="text-danger"
              onClick={() => setRemoval(book.kind === 'local' ? 'local' : 'shared')}
            >
              {book.kind === 'local' ? 'Delete local book' : 'Delete shared book'}
            </button>
          </div>
        )}
        <p className="small muted">
          This is original demo text in a sample reader, not an EPUB rendering engine. Offline
          labels describe mock state, not verified storage.
        </p>
      </div>
      {removal && (
        <RemovalDialog
          book={book}
          kind={removal}
          onClose={() => setRemoval(null)}
          onDone={removal !== 'download' ? () => navigate(fallback, true) : undefined}
          focusAfterConfirm={() =>
            Array.from(document.querySelectorAll<HTMLElement>('[data-route-heading]')).at(-1) ??
            null
          }
        />
      )}
      {downloadDialog && (
        <Dialog title="Preview download outcomes" onClose={() => setDownloadDialog(false)}>
          <p>No bytes are downloaded or verified in this prototype. Choose a simulated outcome.</p>
          <div className="stack">
            <button
              className="primary"
              onClick={() => {
                setDownloads((current) => [...current, book.id]);
                announce('Demo: download marked available in memory only. Nothing was stored.');
                setDownloadDialog(false);
              }}
            >
              Simulate verified availability
            </button>
            <Link
              className="button"
              to="/sync?state=quota"
              onClick={() => setDownloadDialog(false)}
            >
              Preview storage-full failure
            </Link>
          </div>
        </Dialog>
      )}
    </section>
  );
}
