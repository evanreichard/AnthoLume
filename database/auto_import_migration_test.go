package database

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
)

func TestReactUpgradeCreatesFinalImportAndJobSchema(t *testing.T) {
	dir := t.TempDir()
	db := openPreReactDatabase(t, &config.Config{DBType: "sqlite", DBName: "react-upgrade", ConfigPath: dir, DataPath: dir})
	require.NoError(t, db.Reload(context.Background()))

	var version int64
	require.NoError(t, db.DB.QueryRow(`SELECT MAX(version_id) FROM goose_db_version WHERE is_applied = 1`).Scan(&version))
	require.EqualValues(t, 20261126000005, version)
	var migrations, generations int
	require.NoError(t, db.DB.QueryRow(`SELECT count(*) FROM goose_db_version WHERE version_id > 20240510123707 AND is_applied = 1`).Scan(&migrations))
	require.Equal(t, 6, migrations)
	require.NoError(t, db.DB.QueryRow(`SELECT count(*) FROM reading_generation WHERE length(generation) = 32`).Scan(&generations))
	require.Equal(t, 1, generations)

	_, err := db.DB.Exec(`INSERT INTO auto_import_rules
		(id, name, root_id, enabled, watch, interval_minutes, reference, books_added, source_total, last_scan_trigger, next_scan_trigger)
		VALUES ('watch', 'Watch', 'imports', 1, 1, 15, 1, 2, 12, 'on_change', 'manual')`)
	require.NoError(t, err)
	_, err = db.DB.Exec(`UPDATE auto_import_rules SET last_scan_trigger='unknown'`)
	require.ErrorContains(t, err, "CHECK constraint failed")
	_, err = db.DB.Exec(`SELECT library_total FROM auto_import_rules`)
	require.ErrorContains(t, err, "no such column")

	_, err = db.DB.Exec(`INSERT INTO admin_jobs (id, kind, status, started_at, deadline, result)
		VALUES ('import', 'import', 'succeeded', 'start', 'deadline', X'00')`)
	require.NoError(t, err)
	for _, kind := range []string{"backup", "full_backup"} {
		_, err = db.DB.Exec(`INSERT INTO admin_jobs (id, kind, status, started_at, deadline)
			VALUES (?, ?, 'running', 'start', 'deadline')`, kind, kind)
		require.ErrorContains(t, err, "CHECK constraint failed")
	}
}
