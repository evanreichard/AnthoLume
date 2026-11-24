-- +goose Up
CREATE TABLE metadata_provider (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT NOT NULL CHECK (provider IN ('openlibrary', 'hardcover'))
);

-- +goose Down
DROP TABLE metadata_provider;
