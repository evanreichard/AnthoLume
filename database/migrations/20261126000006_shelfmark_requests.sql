-- +goose Up
CREATE TABLE shelfmark_requests (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    book_id TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    description TEXT NOT NULL,
    year INTEGER NOT NULL,
    has_cover BOOLEAN NOT NULL,
    username TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    remote_id INTEGER CHECK (remote_id > 0),
    UNIQUE (provider, book_id)
);

-- +goose Down
DROP TABLE shelfmark_requests;
