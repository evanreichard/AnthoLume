-- +goose Up
DROP TABLE IF EXISTS metadata;

-- +goose Down
-- A downgrade restores the schema, not discarded search results.
CREATE TABLE IF NOT EXISTS metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL REFERENCES documents (id),
    title TEXT,
    author TEXT,
    description TEXT,
    gbid TEXT,
    olid TEXT,
    isbn10 TEXT,
    isbn13 TEXT,
    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
