import { useRef, useState } from 'react';
import { useDemo } from './DemoState';
import { RemovalDialog } from './BookDetail';
import { ImportDemo } from './Library';
import type { Book } from './data';
import { Link } from './navigation';
import { Badge, Cover, Icon, PageHeading } from './ui';

export function Offline() {
  const { signedIn, items, downloads } = useDemo();
  const [importing, setImporting] = useState(false);
  const [removal, setRemoval] = useState<{ book: Book; kind: 'local' | 'download' } | null>(null);
  const localHeading = useRef<HTMLHeadingElement>(null);
  const accountHeading = useRef<HTMLHeadingElement>(null);
  function focusAfterRemoval() {
    if (!removal) return null;
    const section = removal.kind === 'local' ? local : remote;
    const index = section.findIndex((book) => book.id === removal.book.id);
    const next = section[index + 1] ?? section[index - 1];
    return (
      (next ? document.getElementById(`offline-read-${next.id}`) : null) ??
      (removal.kind === 'local' ? localHeading.current : accountHeading.current)
    );
  }
  const local = items.filter((book) => book.kind === 'local');
  const remote = items.filter((book) => downloads.includes(book.id) && book.kind === 'shared');
  function row(book: Book) {
    return (
      <article className="offline-row" key={book.id}>
        <Cover book={book} small />
        <div>
          <Badge tone="good">
            {book.kind === 'local' ? 'Local original · demo' : 'Account download · demo'}
          </Badge>
          <h3>
            <Link to={`/books/${book.id}`}>{book.title}</Link>
          </h3>
          <p>
            {book.author} <span>· {book.size}</span>
          </p>
          <p className="small muted">
            {book.kind === 'local'
              ? 'This browser only · no server activity'
              : 'Alex Rowan · retained on logout'}
          </p>
        </div>
        <div className="offline-actions">
          <Link id={`offline-read-${book.id}`} className="button primary" to={`/read/${book.id}`}>
            Read sample
          </Link>
          <button
            onClick={() => setRemoval({ book, kind: book.kind === 'local' ? 'local' : 'download' })}
          >
            {book.kind === 'local' ? 'Delete local book' : 'Remove download'}
          </button>
        </div>
      </article>
    );
  }
  return (
    <>
      <PageHeading eyebrow="Take your reading with you" title="Offline">
        <button onClick={() => setImporting(true)}>+ Local sample</button>
      </PageHeading>
      <div className="offline-intro">
        <div>
          <h2>
            A small library.
            <br />
            <em>Always close.</em>
          </h2>
          <p>
            Local originals and account downloads have different homes. Know what stays, and what
            you can safely remove.
          </p>
        </div>
        <div className="storage-card">
          <span className="eyebrow">Simulated device storage</span>
          <b>
            {signedIn ? '4.8' : '0.6'} <small>MB</small>
          </b>
          <div className="storage-meter" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <span>Illustration only · no browser storage measured</span>
          <Link to="/sync?state=quota">
            Preview storage-full state <Icon name="arrow" />
          </Link>
        </div>
      </div>
      <div className="notice">
        <b>Offline UI demo, not offline storage</b>
        <p>
          No files are stored or verified. These samples do not prove restart, eviction recovery, or
          PWA behavior.
        </p>
      </div>
      <div className="section-label">
        <h2 ref={localHeading} tabIndex={-1}>
          Local originals
        </h2>
        <span>No account required</span>
      </div>
      <div className="offline-list">
        {local.length ? (
          local.map(row)
        ) : (
          <div className="empty-state">
            <h3>No local books</h3>
            <p>Add a synthetic local sample to try this journey.</p>
            <button onClick={() => setImporting(true)}>Add sample</button>
          </div>
        )}
      </div>
      <div className="section-label">
        <h2 ref={accountHeading} tabIndex={-1}>
          Account downloads
        </h2>
        <span>{signedIn ? 'Alex Rowan · synthetic' : 'Hidden after logout'}</span>
      </div>
      {signedIn ? (
        <div className="offline-list">
          {remote.length ? (
            remote.map(row)
          ) : (
            <div className="empty-state">
              <h3>No account downloads</h3>
              <p>Shared books are still in the Library.</p>
              <Link to="/library">Browse the shared library →</Link>
            </div>
          )}
        </div>
      ) : (
        <div className="locked-card">
          <Icon name="offline" />
          <h3>Your account downloads are retained and hidden.</h3>
          <p>
            Sign in as the same synthetic account to reveal them. Its pending events are paused, not
            sent as another account. Local books above remain available.
          </p>
          <Link className="button" to="/more">
            Sign in to demo account
          </Link>
          <p className="small muted">
            Application-level separation, not encryption. This prototype holds everything in memory
            only.
          </p>
        </div>
      )}
      <Link className="sync-callout" to="/sync">
        <span>
          <b>
            {signedIn ? '2 pending reading events · demo' : 'Original-account events paused · demo'}
          </b>
          <small>Availability and synchronization are separate.</small>
        </span>
        <Icon name="arrow" />
      </Link>
      {importing && <ImportDemo onClose={() => setImporting(false)} />}
      {removal && (
        <RemovalDialog
          {...removal}
          onClose={() => setRemoval(null)}
          focusAfterConfirm={focusAfterRemoval}
        />
      )}
    </>
  );
}
