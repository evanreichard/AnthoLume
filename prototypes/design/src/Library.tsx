import { useEffect, useRef, useState } from 'react';
import { useDemo } from './DemoState';
import type { Book } from './data';
import { LibraryFilterDialog } from './LibraryFilters';
import { libraryQuery, matchesBook, readFilters, type LibraryFilters } from './libraryFilters';
import { Link, navigate } from './navigation';
import { Badge, Cover, Dialog, Icon, PageHeading, SourceBadge } from './ui';
import './library.css';

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
      <div className="book-cover-area">
        <Link to={to} className="book-cover-link" tabIndex={-1} aria-hidden="true">
          <Cover book={book} />
        </Link>
        <SourceBadge kind={book.kind} />
      </div>
      <div className="book-info">
        <p className="eyebrow book-category">{book.category}</p>
        <h3>
          <Link to={to}>{book.title}</Link>
        </h3>
        <p className="author">{book.author}</p>
        <div className="book-meta">
          <Badge tone={available ? 'good' : ''}>
            {available ? 'Available offline · demo' : 'Online only · demo'}
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
  const [filtering, setFiltering] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const filters = readFilters(params);
  const query = params.get('q') || '';
  const accessible = items.filter((book) => signedIn || book.kind === 'local');
  const count = (draft: LibraryFilters) =>
    accessible.filter((book) => matchesBook(book, query, draft, downloads)).length;
  const visible = accessible.filter((book) => matchesBook(book, query, filters, downloads));
  const continuing = visible.find((book) => book.id === 'tidal');
  const resultQuery = libraryQuery(query, filters);
  useEffect(() => {
    setFiltering(false);
  }, [resultQuery]);
  const activeCount = Number(filters.source !== 'all') + Number(filters.availability !== 'all');
  function updateSearch(q: string) {
    const search = libraryQuery(q, filters);
    navigate(`/library${search ? `?${search}` : ''}`, true);
  }
  function applyFilters(next: LibraryFilters) {
    const search = libraryQuery(query, next);
    navigate(`/library${search ? `?${search}` : ''}`);
    setFiltering(false);
  }
  return (
    <section
      className={`library-workspace ${split ? 'split-library' : ''}`}
      aria-label="Book library"
    >
      <PageHeading
        eyebrow={signedIn ? 'Your next chapter' : 'No account needed'}
        title="The library"
      >
        <Link className="quiet-link heading-sync" to="/sync">
          <span className="status-dot" />
          {!signedIn ? 'Events paused' : sync === 'auth' ? 'Sign-in needed' : '2 pending'}
          <Icon name="arrow" />
        </Link>
      </PageHeading>
      <div className="library-search-row">
        <label className="search">
          <Icon name="search" />
          <span className="sr-only">Search title or author</span>
          <input
            ref={searchInput}
            type="search"
            placeholder="Search title or author"
            value={query}
            onChange={(event) => updateSearch(event.target.value)}
          />
          {query && (
            <button
              className="search-clear"
              aria-label="Clear search"
              onClick={() => {
                updateSearch('');
                searchInput.current?.focus({ preventScroll: true });
              }}
            >
              <Icon name="close" />
            </button>
          )}
        </label>
        <button
          className="filter-button icon-button"
          aria-label={`Filter library${activeCount ? ` · ${activeCount} active` : ''}`}
          aria-haspopup="dialog"
          onClick={() => setFiltering(true)}
        >
          <Icon name="filter" />
          {activeCount > 0 && <span>{activeCount}</span>}
        </button>
      </div>
      {activeCount > 0 && (
        <p className="filter-summary">
          {filters.source === 'all'
            ? 'All sources'
            : filters.source === 'shared'
              ? 'Shared library'
              : 'Local originals'}{' '}
          ·{' '}
          {filters.availability === 'all'
            ? 'All availability'
            : filters.availability === 'offline'
              ? 'Available offline'
              : 'Online only'}
        </p>
      )}
      {!signedIn && (
        <p className="scope-note">
          Account records are hidden. Local originals stay usable here, without a login or upload.
        </p>
      )}
      {!query && !activeCount && continuing && (
        <section className="continue-card" aria-label="Continue reading">
          <div className="continue-copy">
            <p className="eyebrow">A little time for reading</p>
            <h2>
              <em>{continuing.title}</em>
            </h2>
            <p className="continue-description">by {continuing.author}</p>
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
            <SourceBadge kind={continuing.kind} />
          </Link>
          <span className="hero-mark" aria-hidden="true">
            24<span>%</span>
          </span>
        </section>
      )}

      <div className="section-label">
        <h2>{query ? 'Search results' : 'On the shelves'}</h2>
        <span>
          {visible.length} {visible.length === 1 ? 'title' : 'titles'} · synthetic
        </span>
      </div>
      <div className="source-legend">
        <span>
          <Icon name="shared" />
          Shared library
        </span>
        <span>
          <Icon name="device" />
          Local original
        </span>
        <button
          className="add-button"
          aria-label="Add local sample"
          onClick={() => setImporting(true)}
        >
          +<span className="library-add-label"> Local sample</span>
        </button>
      </div>
      {visible.length ? (
        <div className="book-grid">
          {visible.map((book) => (
            <BookRow key={book.id} book={book} query={resultQuery} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="search" />
          <h3>No matching titles</h3>
          <p>Try another title/author or adjust the source and availability filters.</p>
          <button onClick={() => setFiltering(true)}>Review filters</button>
        </div>
      )}
      {importing && <ImportDemo onClose={() => setImporting(false)} />}
      {filtering && (
        <LibraryFilterDialog
          filters={filters}
          signedIn={signedIn}
          count={count}
          onApply={applyFilters}
          onClose={() => setFiltering(false)}
        />
      )}
    </section>
  );
}
