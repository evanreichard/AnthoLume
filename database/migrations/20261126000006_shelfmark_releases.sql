-- +goose Up
CREATE TABLE shelfmark_releases (
    release_key TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    release_title TEXT NOT NULL,
    release_author TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL,
    size TEXT NOT NULL,
    language TEXT NOT NULL,
    indexer TEXT NOT NULL,
    provider TEXT NOT NULL,
    book_id TEXT NOT NULL,
    book_title TEXT NOT NULL,
    author TEXT NOT NULL,
    description TEXT NOT NULL,
    year INTEGER NOT NULL,
    has_cover BOOLEAN NOT NULL,
    username TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (state IN ('unconfirmed', 'rejected', 'queued'))
);
CREATE INDEX shelfmark_releases_book ON shelfmark_releases (provider, book_id, requested_at DESC, release_key DESC);

-- +goose Down
DROP TABLE shelfmark_releases;
