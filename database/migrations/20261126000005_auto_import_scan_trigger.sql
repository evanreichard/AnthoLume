-- +goose Up
ALTER TABLE auto_import_rules ADD COLUMN last_scan_trigger TEXT CHECK(last_scan_trigger IN ('on_change', 'scheduled', 'manual', 'initial'));
ALTER TABLE auto_import_rules ADD COLUMN next_scan_trigger TEXT CHECK(next_scan_trigger IN ('on_change', 'scheduled', 'manual', 'initial'));

-- +goose Down
ALTER TABLE auto_import_rules DROP COLUMN next_scan_trigger;
ALTER TABLE auto_import_rules DROP COLUMN last_scan_trigger;
