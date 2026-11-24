-- +goose Up
CREATE TABLE IF NOT EXISTS hardcover_links (
    account_id TEXT PRIMARY KEY NOT NULL REFERENCES account_identities(account_id) ON DELETE CASCADE,
    credential BLOB NOT NULL
);

-- +goose Down
DROP TABLE hardcover_links;
