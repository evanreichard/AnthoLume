package api

import (
	"bytes"
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/database"
)

func TestRestoreMigratesPreReactBackup(t *testing.T) {
	ctx := context.Background()
	name := filepath.Join(t.TempDir(), adminBackupName)
	legacy, err := sql.Open("sqlite", name)
	require.NoError(t, err)
	legacy.SetMaxOpenConns(1)
	require.NoError(t, database.InitPreReactSchema(ctx, legacy))
	_, err = legacy.Exec(`INSERT INTO users(id,pass,auth_hash,admin) VALUES('old-owner','synthetic','synthetic',1);
INSERT INTO documents(id,title,filepath,basepath) VALUES('old-book','Old title','old.epub','/different-server/documents');
INSERT INTO documents(id,title,filepath,basepath,deleted) VALUES('deleted-book','Deleted title','deleted.epub','/different-server/documents',1);
INSERT INTO devices(id,user_id,device_name) VALUES('old-device','old-owner','Reader');
INSERT INTO document_progress(user_id,document_id,device_id,percentage,progress) VALUES('old-owner','old-book','old-device',.5,'old position');`)
	require.NoError(t, err)
	require.NoError(t, legacy.Close())
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
			again, err := os.ReadFile(name)
			require.NoError(t, err)
			require.True(t, bytes.Equal(original, again))
		})
	}
}

func TestRestoreCustomDatabaseMemberRequiresPreReactSchema(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	name := filepath.Join(t.TempDir(), adminBackupName)
	require.NoError(t, f.api.writeVerifiedSnapshot(context.Background(), name))
	current, err := os.ReadFile(name)
	require.NoError(t, err)
	payload := zipStoragePaths(t, "custom.db", current, nil, nil)
	response := f.call("POST", "/api/v1/admin/restore", string(payload), map[string]string{"Content-Type": "application/octet-stream"})
	assertProblem(t, response, 400, "incompatible_restore_database")
}

func TestRestoreRejectsUnknownHistoricalSchemaAndNewerVersion(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	for _, kind := range []string{"unknown historical schema", "newer version"} {
		t.Run(kind, func(t *testing.T) {
			ctx := context.Background()
			name := filepath.Join(t.TempDir(), adminBackupName)
			if kind == "newer version" {
				require.NoError(t, f.api.writeVerifiedSnapshot(ctx, name))
			}
			snapshot, err := sql.Open("sqlite", name)
			require.NoError(t, err)
			snapshot.SetMaxOpenConns(1)
			if kind == "unknown historical schema" {
				require.NoError(t, database.InitPreReactSchema(ctx, snapshot))
				_, err = snapshot.Exec(`CREATE TABLE unexpected_table (key TEXT)`)
			} else {
				_, err = snapshot.Exec(`INSERT INTO goose_db_version(version_id,is_applied) VALUES (99999999999999,1)`)
			}
			require.NoError(t, err)
			require.NoError(t, snapshot.Close())
			payload, err := os.ReadFile(name)
			require.NoError(t, err)
			response := f.call("POST", "/api/v1/admin/restore", string(payload), map[string]string{"Content-Type": "application/octet-stream"})
			assertProblem(t, response, 400, "incompatible_restore_database")
			_, err = os.Stat(filepath.Join(f.api.adminBackupDir(), "restore-ready"))
			require.ErrorIs(t, err, os.ErrNotExist)
			require.Equal(t, 1, f.count("users"))
		})
	}
}
