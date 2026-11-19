-- +goose Up
ALTER TABLE auto_import_rules RENAME COLUMN library_total TO source_total;
UPDATE auto_import_rules SET books_added = NULL, source_total = NULL;

-- +goose Down
ALTER TABLE auto_import_rules RENAME COLUMN source_total TO library_total;
UPDATE auto_import_rules SET books_added = NULL, library_total = NULL;
