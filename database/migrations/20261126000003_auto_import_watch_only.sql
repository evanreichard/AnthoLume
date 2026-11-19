-- +goose Up
ALTER TABLE auto_import_rules ADD COLUMN books_added INTEGER CHECK(books_added >= 0);
ALTER TABLE auto_import_rules ADD COLUMN library_total INTEGER CHECK(library_total >= 0);

-- Match the old recurring schedule without clearing initial scans, manual scans, or short retries.
UPDATE auto_import_rules
SET next_scan = NULL
WHERE watch
  AND next_scan = strftime('%Y-%m-%dT%H:%M:%fZ', last_scan, printf('+%d minutes', interval_minutes));

-- +goose Down
-- Old runners treat NULL next_scan as due and resume periodic scanning.
ALTER TABLE auto_import_rules DROP COLUMN library_total;
ALTER TABLE auto_import_rules DROP COLUMN books_added;
