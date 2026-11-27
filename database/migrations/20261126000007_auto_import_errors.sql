-- +goose Up
ALTER TABLE auto_import_rules ADD COLUMN scan_errors BLOB;

-- +goose Down
ALTER TABLE auto_import_rules DROP COLUMN scan_errors;
