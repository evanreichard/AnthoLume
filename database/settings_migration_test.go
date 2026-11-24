package database

import (
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
	dbmigrations "reichard.io/antholume/database/migrations"
)

func TestSettingsMigrationKeepsNewestRowPerName(t *testing.T) {
	ctx := t.Context()
	dir := t.TempDir()
	db := openPreReactDatabase(t, &config.Config{DBType: "sqlite", DBName: "settings", ConfigPath: dir, DataPath: dir})
	provider, err := migrationProvider(db.DB)
	require.NoError(t, err)
	_, err = provider.UpTo(dbmigrations.WithRestoreStorageDataPath(ctx, dir), 20261126000004)
	require.NoError(t, err)
	_, err = db.DB.Exec(`INSERT INTO settings(id, name, value, created_at) VALUES
		(1001, 'migration_test', 'first', '2026-01-02T12:00:00Z'),
		(1002, 'other_preference', 'untouched', '2026-01-02T12:00:00Z'),
		(1003, 'migration_test', 'latest', '2026-01-01T12:00:00Z')`)
	require.NoError(t, err)

	require.NoError(t, MigrateRestore(ctx, db.DB, dir))
	var id int64
	var value, createdAt string
	require.NoError(t, db.DB.QueryRow(`SELECT id, value, created_at FROM settings WHERE name = 'migration_test'`).Scan(&id, &value, &createdAt))
	require.EqualValues(t, 1003, id)
	require.Equal(t, "latest", value)
	require.Equal(t, "2026-01-01T12:00:00Z", createdAt)
	require.NoError(t, db.DB.QueryRow(`SELECT value FROM settings WHERE name = 'other_preference'`).Scan(&value))
	require.Equal(t, "untouched", value)
	_, err = db.DB.Exec(`INSERT INTO settings(name, value) VALUES ('migration_test', 'duplicate')`)
	require.ErrorContains(t, err, "UNIQUE constraint failed: settings.name")
	saved, err := New(db.DB).UpdateSettings(ctx, UpdateSettingsParams{Name: "migration_test", Value: "updated"})
	require.NoError(t, err)
	require.EqualValues(t, 1003, saved.ID)
	require.Equal(t, "updated", saved.Value)
}
