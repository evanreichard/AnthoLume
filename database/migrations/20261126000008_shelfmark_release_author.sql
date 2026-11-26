-- +goose Up
ALTER TABLE shelfmark_releases ADD COLUMN release_author TEXT NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE shelfmark_releases DROP COLUMN release_author;
