package api

import (
	"archive/zip"
	"context"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStorageUpgradeRelativeBasePath(t *testing.T) {
	for _, changed := range []bool{false, true} {
		name := "unchanged data path"
		if changed {
			name = "changed data path"
		}
		t.Run(name, func(t *testing.T) {
			f := newWebFixture(t)
			f.register("owner")
			cwd, err := os.Getwd()
			require.NoError(t, err)
			originalData := f.cfg.DataPath
			oldLibrary := filepath.Join(originalData, "documents")
			legacyBase, err := filepath.Rel(cwd, oldLibrary)
			require.NoError(t, err)
			book, err := os.ReadFile("../_test_files/alice.epub")
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(filepath.Join(oldLibrary, "legacy.epub"), book, 0600))

			// Recreate pre-upgrade storage columns and a historical device position.
			f.exec(`ALTER TABLE documents DROP COLUMN storage_root_id;
 DROP TABLE auto_import_rules; DROP TABLE storage_roots;
 INSERT INTO documents(id,filepath,basepath) VALUES('legacy-book','./legacy.epub',?);
 INSERT INTO devices(id,user_id,device_name) VALUES('legacy-device','owner','Reader');
 INSERT INTO document_progress(user_id,document_id,device_id,progress,percentage) VALUES('owner','legacy-book','legacy-device','original position',0.25)`, legacyBase)
			f.rewindReactMigrations()
			if changed {
				f.cfg.DataPath = filepath.Join(t.TempDir(), "new-data")
				f.cfg.EnsureDirectories()
			} else {
				f.cfg.DataPath, err = filepath.Rel(cwd, originalData)
				require.NoError(t, err)
			}
			require.NoError(t, f.db.Reload(context.Background()))
			var rootID string
			require.NoError(t, f.db.DB.QueryRow(`SELECT storage_root_id FROM documents WHERE id='legacy-book'`).Scan(&rootID))
			file := func() {
				t.Helper()
				r := f.call("GET", "/api/v1/documents/legacy-book/file", nil, nil)
				require.Equal(t, 200, r.status)
				require.Equal(t, book, r.body)
			}
			backupFiles := func(want int) {
				t.Helper()
				r := f.call("GET", "/api/v1/admin/backup/preview", nil, nil)
				require.Equal(t, 200, r.status, string(r.body))
				require.Equal(t, want, decodeWeb[AdminBackupPreview](t, r).Files)
			}
			file()
			if changed {
				require.NotEqual(t, libraryRoot, rootID)
				backupFiles(0)
				newLibrary := filepath.Join(f.cfg.DataPath, "documents")
				root, err := f.api.storageRoot(context.Background(), rootID)
				require.NoError(t, err)
				require.False(t, root.Managed)
				require.Equal(t, oldLibrary, root.Path)
				require.Equal(t, legacyBase, *root.LegacyPath)
				managed, err := f.api.storageRoot(context.Background(), libraryRoot)
				require.NoError(t, err)
				require.Equal(t, newLibrary, managed.Path)
				require.NoError(t, os.WriteFile(filepath.Join(newLibrary, "legacy.epub"), book, 0600))
				const makeLibrary = "/api/v1/admin/storage-roots/make-library"
				r := f.call("GET", makeLibrary+"?id="+rootID+"&path="+url.QueryEscape(newLibrary), nil, nil)
				require.Equal(t, 200, r.status, string(r.body))
				plan := decodeWeb[MakeLibraryPlan](t, r)
				require.True(t, plan.SameFolder)
				require.Equal(t, 1, plan.Incoming)
				r = f.call("POST", makeLibrary, plan, nil)
				require.Equal(t, 204, r.status, string(r.body))
				require.FileExists(t, filepath.Join(oldLibrary, "legacy.epub"))
			} else {
				require.Equal(t, libraryRoot, rootID)
			}
			file()
			backupFiles(1)
			backupDir := filepath.Join(t.TempDir(), "export")
			require.NoError(t, f.api.createFullBackup(context.Background(), backupDir))
			archive, err := zip.OpenReader(filepath.Join(backupDir, fullBackupName))
			require.NoError(t, err)
			defer archive.Close()
			entry, err := archive.Open("documents/library/legacy.epub")
			require.NoError(t, err)
			defer entry.Close()
			bundled, err := io.ReadAll(entry)
			require.NoError(t, err)
			require.Equal(t, book, bundled)
			var position string
			require.NoError(t, f.db.DB.QueryRow(`SELECT position FROM reading_heads WHERE user_id='owner' AND document_id='legacy-book'`).Scan(&position))
			require.Equal(t, "original position", position)
		})
	}
}
