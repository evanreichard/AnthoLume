package database

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
)

func TestAutoImportWatchOnlyClearsOldRecurringScans(t *testing.T) {
	dir := t.TempDir()
	db := NewMgr(&config.Config{DBType: "sqlite", DBName: "auto-import", ConfigPath: dir, DataPath: dir})
	defer func() { require.NoError(t, db.DB.Close()) }()

	_, err := db.DB.Exec(`
ALTER TABLE auto_import_rules DROP COLUMN next_scan_trigger;
ALTER TABLE auto_import_rules DROP COLUMN last_scan_trigger;
ALTER TABLE auto_import_rules DROP COLUMN source_total;
ALTER TABLE auto_import_rules DROP COLUMN books_added;
DELETE FROM goose_db_version WHERE version_id>=20261126000003;
INSERT INTO auto_import_rules (id, name, root_id, enabled, watch, interval_minutes, reference, last_scan, next_scan) VALUES
	('watch', 'Watch', 'imports', 1, 1, 15, 1, '2026-11-30T12:00:00.123Z', '2026-11-30T12:15:00.123Z'),
	('scheduled', 'Scheduled', 'imports', 1, 0, 15, 1, '2026-11-30T12:00:00.123Z', '2026-11-30T12:15:00.123Z'),
	('manual', 'Manual', 'imports', 1, 1, 15, 1, '2026-11-30T12:00:00.123Z', '2026-11-30T12:01:00.123Z'),
	('initial', 'Initial', 'imports', 1, 1, 15, 1, NULL, '2026-11-30T12:01:00.123Z');
`)
	require.NoError(t, err)
	require.NoError(t, db.Reload(context.Background()))

	for id, want := range map[string]string{
		"watch": "", "scheduled": "2026-11-30T12:15:00.123Z",
		"manual": "2026-11-30T12:01:00.123Z", "initial": "2026-11-30T12:01:00.123Z",
	} {
		var next sql.NullString
		require.NoError(t, db.DB.QueryRow(`SELECT next_scan FROM auto_import_rules WHERE id=?`, id).Scan(&next))
		require.Equal(t, want != "", next.Valid, id)
		require.Equal(t, want, next.String, id)
	}
}
