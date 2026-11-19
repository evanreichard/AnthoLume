package database

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
)

func TestBackupSnapshotUsesSeparateWALReader(t *testing.T) {
	dir := t.TempDir()
	db := NewMgr(&config.Config{DBType: "sqlite", DBName: "live", ConfigPath: dir, DataPath: dir})
	defer db.DB.Close()
	_, err := db.DB.Exec(`INSERT INTO documents(id,title) VALUES('book','committed')`)
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := db.DB.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `UPDATE documents SET title='uncommitted' WHERE id='book'`)
	require.NoError(t, err)

	name := filepath.Join(dir, "snapshot.db")
	require.NoError(t, db.BackupSnapshot(ctx, name))
	snapshot, err := sql.Open("sqlite", name)
	require.NoError(t, err)
	defer snapshot.Close()
	var title string
	require.NoError(t, snapshot.QueryRowContext(ctx, `SELECT title FROM documents WHERE id='book'`).Scan(&title))
	require.Equal(t, "committed", title)
}
