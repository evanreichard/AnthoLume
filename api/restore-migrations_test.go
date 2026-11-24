package api

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
	dbmigrations "reichard.io/antholume/database/migrations"
)

func TestRestoreMigratesPreReactBackup(t *testing.T) {
	name, source := copyPreReactBackup(t)
	_, err := source.Exec(`CREATE TABLE custom_metadata (note TEXT); INSERT INTO custom_metadata VALUES ('keep me')`)
	require.NoError(t, err)
	require.NoError(t, source.Close())
	original, err := os.ReadFile(name)
	require.NoError(t, err)
	for _, tc := range []struct {
		name, dbMember string
		full           bool
	}{
		{"raw database", "", false},
		{"default full archive", adminBackupName, true},
		{"custom database only archive", "my library.db", false},
		{"custom full archive", "my library.db", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newWebFixture(t)
			f.register("destination-owner")
			book := []byte("original book bytes")
			payload := original
			if tc.dbMember != "" {
				var files []string
				if tc.full {
					files = []string{"documents/old.epub", "documents/deleted.epub"}
				}
				payload = zipStoragePaths(t, tc.dbMember, original, files, book)
			}
			staged := f.call("POST", "/api/v1/admin/restore", string(payload), map[string]string{"Content-Type": "application/octet-stream"})
			require.Equal(t, 200, staged.status, string(staged.body))
			require.Equal(t, 0, f.count("documents"))
			candidate := decodeWeb[AdminRestore](t, staged)
			applied := f.call("PATCH", "/api/v1/admin/restore", AdminRestoreApply{Token: candidate.Token}, nil)
			require.Equal(t, 204, applied.status, string(applied.body))
			var position, path, root string
			require.NoError(t, f.db.DB.QueryRow(`SELECT h.position,d.filepath,d.storage_root_id FROM reading_heads h JOIN documents d ON d.id=h.document_id WHERE h.user_id='old-owner'`).Scan(&position, &path, &root))
			require.Equal(t, "old position", position)
			var note string
			require.NoError(t, f.db.DB.QueryRow(`SELECT note FROM custom_metadata`).Scan(&note))
			require.Equal(t, "keep me", note)
			if tc.full {
				require.Equal(t, libraryRoot, root)
				require.Equal(t, "old.epub", path)
				for _, file := range []string{path, "deleted.epub"} {
					data, err := os.ReadFile(filepath.Join(f.cfg.DataPath, "documents", file))
					require.NoError(t, err)
					require.Equal(t, book, data)
				}
			} else {
				require.NotEqual(t, libraryRoot, root)
				require.Nil(t, candidate.LibraryPath)
			}
		})
	}
}

func TestRestoreRejectsFailedMigrationAndNewerVersion(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	for _, tc := range []struct{ name, damage string }{
		{"migration failure", `ALTER TABLE documents RENAME TO missing_documents`},
		{"newer version", `INSERT INTO goose_db_version(version_id,is_applied) VALUES (99999999999999,1)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			name, snapshot := copyPreReactBackup(t)
			_, err := snapshot.Exec(tc.damage)
			require.NoError(t, err)
			require.NoError(t, snapshot.Close())
			payload, err := os.ReadFile(name)
			require.NoError(t, err)
			response := f.call("POST", "/api/v1/admin/restore", string(payload), map[string]string{"Content-Type": "application/octet-stream"})
			assertProblem(t, response, 400, "incompatible_restore_database")
			_, err = os.Stat(filepath.Join(f.api.adminBackupDir(), "restore-ready"))
			require.ErrorIs(t, err, os.ErrNotExist)
			var owner string
			require.NoError(t, f.db.DB.QueryRow(`SELECT id FROM users`).Scan(&owner))
			require.Equal(t, "owner", owner)
		})
	}
}

func copyPreReactBackup(t *testing.T) (string, *sql.DB) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "pre-react.db"))
	require.NoError(t, err)
	name := filepath.Join(t.TempDir(), adminBackupName)
	require.NoError(t, os.WriteFile(name, data, 0600))
	db, err := sql.Open("sqlite", name)
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	return name, db
}

func upgradeTestBackupTo(t *testing.T, db *sql.DB, version int64) {
	t.Helper()
	provider, err := goose.NewProvider(goose.DialectSQLite3, db, os.DirFS("../database/migrations"))
	require.NoError(t, err)
	ctx := dbmigrations.WithRestoreStorageDataPath(context.Background(), t.TempDir())
	_, err = provider.UpTo(ctx, version)
	require.NoError(t, err)
}
