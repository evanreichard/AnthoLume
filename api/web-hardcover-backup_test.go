package api

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/database"
)

func TestPortableBackupsOmitHardcoverCredentials(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	live := []byte("active credential ciphertext marker")
	old := []byte("old credential ciphertext marker")
	f.exec(`INSERT INTO hardcover_links SELECT account_id, ? FROM account_identities WHERE user_id='owner'`, bytes.Repeat(old, 1024))
	f.exec(`UPDATE hardcover_links SET credential = ?`, bytes.Repeat(live, 1024))

	var restoreToken string
	for _, tc := range []struct{ name, query string }{{"database", ""}, {"full archive", "?full=true"}} {
		t.Run(tc.name, func(t *testing.T) {
			result := f.call("GET", adminBackupEndpoint+tc.query, nil, nil)
			require.Equal(t, 200, result.status)
			data := result.body
			if tc.query != "" {
				archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
				require.NoError(t, err)
				for _, file := range archive.File {
					require.NotContains(t, file.Name, adminBackupName+"-")
				}
				member, err := archive.Open(adminBackupName)
				require.NoError(t, err)
				defer member.Close()
				data, err = io.ReadAll(member)
				require.NoError(t, err)
			}
			require.False(t, bytes.Contains(data, live))
			require.False(t, bytes.Contains(data, old))
			catalog := openExportedCatalog(t, data)
			var links int
			require.NoError(t, catalog.QueryRow(`SELECT count(*) FROM hardcover_links`).Scan(&links))
			require.Zero(t, links)
			require.Equal(t, 1, f.count("hardcover_links"))
			staged := f.call("POST", "/api/v1/admin/restore", string(result.body), map[string]string{"Content-Type": "application/octet-stream"})
			require.Equal(t, 200, staged.status, string(staged.body))
			restoreToken = decodeWeb[AdminRestore](t, staged).Token
		})
	}

	applied := f.call("PATCH", "/api/v1/admin/restore", AdminRestoreApply{Token: restoreToken}, nil)
	require.Equal(t, 204, applied.status, string(applied.body))
	require.Zero(t, f.count("hardcover_links"))
}

func TestRestoreRejectsSnapshotWithHardcoverCredentials(t *testing.T) {
	ctx := context.Background()
	f := newWebFixture(t)
	f.register("owner")
	live := []byte("active credential ciphertext marker")
	f.exec(`INSERT INTO hardcover_links SELECT account_id, ? FROM account_identities WHERE user_id='owner'`, live)
	name := filepath.Join(t.TempDir(), adminBackupName)
	require.NoError(t, f.db.BackupSnapshot(ctx, name))
	raw, err := os.ReadFile(name)
	require.NoError(t, err)
	require.True(t, bytes.Contains(raw, live), "ordinary snapshots are not redacted")
	staged := f.call("POST", "/api/v1/admin/restore", string(raw), map[string]string{"Content-Type": "application/octet-stream"})
	assertProblem(t, staged, 400, "incompatible_restore_database")
	require.Equal(t, 1, f.count("hardcover_links"))
}

func TestRestoreMigratesSnapshotBeforeHardcover(t *testing.T) {
	ctx := context.Background()
	name := filepath.Join(t.TempDir(), adminBackupName)
	old, err := sql.Open("sqlite", name)
	require.NoError(t, err)
	require.NoError(t, database.InitHistoricalSchema(ctx, old, database.ScopedDevicesSchemaVersion))
	_, err = old.Exec(`INSERT INTO users(id,pass,auth_hash,admin) VALUES ('owner','pass','hash',1);
INSERT INTO documents(id,title) VALUES ('book','Before Hardcover');`)
	require.NoError(t, err)
	require.NoError(t, old.Close())
	payload, err := os.ReadFile(name)
	require.NoError(t, err)

	f := newWebFixture(t)
	require.NoError(t, f.api.RestoreFreshInstance(ctx, bytes.NewReader(payload)))
	require.Equal(t, 1, f.count("users"))
	require.Equal(t, 1, f.count("documents"))
	require.Zero(t, f.count("hardcover_links"))
}
