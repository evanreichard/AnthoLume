import { useState } from 'react';
import { useDemo } from './DemoState';
import type { Book } from './data';
import { Link, navigate } from './navigation';
import { Badge, Cover, Dialog, Icon, PageHeading } from './ui';

export function ImportDemo({ onClose }: { onClose: () => void }) {
  const { items, setItems, announce } = useDemo();
  const exists = items.some((book) => book.id === 'walk');
  return (
    <Dialog title="Import a local book" onClose={onClose}>
      <p>
        Local books belong to this browser, not the shared library. No account or upload is needed.
      </p>
      <div className="notice">
        <b>Simulation only</b>
        <p>
          This study does not read or store EPUB files. Use an original sample to preview the
          local-book journey.
        </p>
      </div>
      <button
        className="primary full"
        disabled={exists}
        onClick={() => {
          setItems((current) => [
            ...current,
            {
              id: 'walk',
              title: 'A Walk Before Rain',
              author: 'Alex Rowan',
              kind: 'local',
              cover: 'garden',
              category: 'Local manuscript',
              description:
                'An original synthetic manuscript added for this session only. No file has been imported.',
              progress: 0,
              size: '0.4 MB',
            },
          ]);
          announce('Demo: local sample added in memory. No file was imported.');
          onClose();
        }}
      >
        {exists ? 'Sample already added' : 'Add synthetic local sample'}
      </button>
      <p className="muted small">Nothing leaves this page. Reloading discards the sample.</p>
    </Dialog>
  );
}

export function BookRow({
  book,
  query = '',
  compact = false,
}: {
  book: Book;
  query?: string;
  compact?: boolean;
}) {
  const { downloads } = useDemo();
  const available = book.kind === 'local' || downloads.includes(book.id);
  const to = `/books/${book.id}${query ? `?${query}` : ''}`;
  return (
    <article className={`book-card ${compact ? 'compact' : ''}`}>
      <Link to={to} className="book-cover-link" tabIndex={-1} aria-hidden="true">
        <Cover book={book} />
      </Link>
      <div className="book-info">
        <p className="eyebrow book-category">{book.category}</p>
        <h3>
          <Link to={to}>{book.title}</Link>
        </h3>
        <p className="author">{book.author}</p>
        <div className="book-meta">
          <Badge tone={available ? 'good' : ''}>
            {book.kind === 'local'
              ? 'Local only'
              : available
                ? 'Offline · demo'
                : 'Online only · demo'}
          </Badge>
          <span>{book.progress ? `${book.progress}% read` : 'Not started'}</span>
        </div>
        {book.progress > 0 && (
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${book.progress}%` }} />
          </div>
        )}
      </div>
      <Link className="row-open" to={to} aria-label={`Details for ${book.title}`}>
        <Icon name="arrow" />
      </Link>
    </article>
  );
}

export function Library({ params, split = false }: { params: URLSearchParams; split?: boolean }) {
  const { items, signedIn, downloads, sync } = useDemo();
  const [importing, setImporting] = useState(false);
  const scope = !signedIn ? 'local' : params.get('scope') || 'shared';
  const query = params.get('q') || '';
  const visible = items.filter(
    (book) =>
      book.kind === scope &&
      `${book.title} ${book.author}`.toLowerCase().includes(query.toLowerCase()),
  );
  const continuing = items.find((book) => book.id === 'tidal');
  const filters = new URLSearchParams({ scope, ...(query ? { q: query } : {}) }).toString();
  function updateFilters(next: { scope?: string; q?: string }) {
    const search = new URLSearchParams({ scope: next.scope ?? scope, q: next.q ?? query });
    if (!search.get('q')) search.delete('q');
    navigate(`/library?${search}`, true);
  }
  return (
    <section
      className={`library-workspace ${split ? 'split-library' : ''}`}
      aria-label="Book library"
    >
      <PageHeading
        eyebrow={signedIn ? 'Your next chapter' : 'No account needed'}
        title={signedIn ? 'The library' : 'Local books'}
      >
        <Link className="quiet-link heading-sync" to="/sync">
          <span className="status-dot" />
          {!signedIn ? 'Events paused' : sync === 'auth' ? 'Sign-in needed' : '2 pending'}
          <Icon name="arrow" />
        </Link>
      </PageHeading>
      {!query && scope === 'shared' && continuing && (
        <section className="continue-card" aria-label="Continue reading">
          <div className="continue-copy">
            <p className="eyebrow">Make a little time</p>
            <h2>
              Return to
              <br />
              <em>the water.</em>
            </h2>
            <p className="continue-description">
              {continuing.title} <span>by {continuing.author}</span>
            </p>
            <p className="continue-position">
              Chapter 1 · 24%{' '}
              <span>· {downloads.includes('tidal') ? 'Offline sample' : 'Online sample'}</span>
            </p>
            <Link className="primary" to="/read/tidal">
              Resume reading <Icon name="arrow" />
            </Link>
          </div>
          <Link to="/books/tidal" className="hero-cover" aria-label="Details for The Tidal Atlas">
            <Cover book={continuing} />
          </Link>
          <span className="hero-mark" aria-hidden="true">
            24<span>%</span>
          </span>
        </section>
      )}
      <div className="library-tools">
        <div className="segmented" aria-label="Library scope">
          {signedIn && (
            <button
              aria-pressed={scope === 'shared'}
              onClick={() => updateFilters({ scope: 'shared' })}
            >
              Shared library
            </button>
          )}
          <button
            aria-pressed={scope === 'local'}
            onClick={() => updateFilters({ scope: 'local' })}
          >
            Local books
          </button>
        </div>
        <button className="add-button" onClick={() => setImporting(true)}>
          + Local sample
        </button>
      </div>
      <label className="search">
        <Icon name="search" />
        <span className="sr-only">Search title or author</span>
        <input
          type="search"
          placeholder="Search title or author"
          value={query}
          onChange={(event) => updateFilters({ q: event.target.value })}
        />
        {query && (
          <button aria-label="Clear search" onClick={() => updateFilters({ q: '' })}>
            <Icon name="close" />
          </button>
        )}
      </label>
      <div className="section-label">
        <h2>
          {query ? 'Search results' : scope === 'shared' ? 'On the shelves' : 'In this browser'}
        </h2>
        <span>
          {visible.length} {visible.length === 1 ? 'title' : 'titles'} · synthetic
        </span>
      </div>
      {scope === 'local' && (
        <p className="scope-note">
          Local originals stay separate from the shared library. No server reading activity is
          recorded.
        </p>
      )}
      {visible.length ? (
        <div className="book-grid">
          {visible.map((book) => (
            <BookRow key={book.id} book={book} query={filters} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="search" />
          <h3>No matching titles</h3>
          <p>Try a title or author, or clear your search.</p>
          <button onClick={() => updateFilters({ q: '' })}>Clear search</button>
        </div>
      )}
      {importing && <ImportDemo onClose={() => setImporting(false)} />}
    </section>
  );
}
