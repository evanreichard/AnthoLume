package api

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRestoreNormalizesSnapshotPageSize(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	f.exec(`INSERT INTO documents(id,title) VALUES ('original','From the backup')`)
	var mode string
	require.NoError(t, f.db.DB.QueryRow(`PRAGMA journal_mode`).Scan(&mode))
	require.Equal(t, "wal", mode)
	var liveSize int
	require.NoError(t, f.db.DB.QueryRow(`PRAGMA page_size`).Scan(&liveSize))
	name := filepath.Join(t.TempDir(), adminBackupName)
	require.NoError(t, f.api.writeVerifiedSnapshot(context.Background(), name))
	change := `PRAGMA page_size=8192; VACUUM`
	if liveSize == 8192 {
		change = `PRAGMA page_size=4096; VACUUM`
	}
	db, err := sql.Open("sqlite", name)
	require.NoError(t, err)
	_, err = db.Exec(change)
	require.NoError(t, err)
	var backupSize int
	require.NoError(t, db.QueryRow(`PRAGMA page_size`).Scan(&backupSize))
	require.NotEqual(t, liveSize, backupSize)
	require.NoError(t, db.Close())
	payload, err := os.ReadFile(name)
	require.NoError(t, err)
	f.exec(`DELETE FROM documents WHERE id='original'`)

	staged := f.call("POST", "/api/v1/admin/restore", string(payload), map[string]string{"Content-Type": "application/octet-stream"})
	require.Equal(t, 200, staged.status, string(staged.body))
	require.NoError(t, f.api.checkRestorePageSize(context.Background(), filepath.Join(f.api.adminBackupDir(), "restore-ready", adminBackupName)))
	require.Zero(t, f.count("documents"))
	candidate := decodeWeb[AdminRestore](t, staged)
	applied := f.call("PATCH", "/api/v1/admin/restore", AdminRestoreApply{Token: candidate.Token}, nil)
	require.Equal(t, 204, applied.status, string(applied.body))
	var title string
	require.NoError(t, f.db.DB.QueryRow(`SELECT title FROM documents WHERE id='original'`).Scan(&title))
	require.Equal(t, "From the backup", title)
	var size int
	require.NoError(t, f.db.DB.QueryRow(`PRAGMA page_size`).Scan(&size))
	require.Equal(t, liveSize, size)
}
