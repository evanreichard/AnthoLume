package api

import (
	"archive/zip"
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStoragePathStartupRepairAndBackup(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	book, err := os.ReadFile("../_test_files/alice.epub")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(f.cfg.DataPath, "documents", "book.epub"), book, 0600))
	f.exec(`INSERT INTO documents(id,filepath,storage_root_id) VALUES ('legacy','./book.epub','library'),('unsafe','./../book.epub','library'); DROP TABLE auto_import_rules; DELETE FROM goose_db_version WHERE version_id>=20261126000000`)
	require.NoError(t, f.db.Reload(context.Background()))
	var name string
	require.NoError(t, f.db.DB.QueryRow(`SELECT filepath FROM documents WHERE id='legacy'`).Scan(&name))
	require.Equal(t, "book.epub", name)
	require.NoError(t, f.db.DB.QueryRow(`SELECT filepath FROM documents WHERE id='unsafe'`).Scan(&name))
	require.Equal(t, "./../book.epub", name)
	response := f.call("GET", "/api/v1/documents/legacy/file", nil, nil)
	require.Equal(t, 200, response.status)
	require.Equal(t, book, response.body)
	assertProblem(t, f.call("GET", "/api/v1/documents/unsafe/file", nil, nil), 404, "not_found")
	backupDir := filepath.Join(t.TempDir(), "export")
	require.NoError(t, f.api.createFullBackup(context.Background(), backupDir))
	archive, err := zip.OpenReader(filepath.Join(backupDir, fullBackupName))
	require.NoError(t, err)
	defer archive.Close()
	entry, err := archive.Open("documents/library/book.epub")
	require.NoError(t, err)
	entry.Close()
}

func TestStoragePathRestoreLegacyBackups(t *testing.T) {
	for _, format := range []string{"database", "archive"} {
		t.Run(format, func(t *testing.T) {
			f := newWebFixture(t)
			f.register("owner")
			f.exec(`UPDATE users SET admin=1 WHERE id='owner'; INSERT INTO documents(id,filepath,coverfile,storage_root_id) VALUES ('legacy','./book.epub','./cover.png','library'); DROP TABLE auto_import_rules; DELETE FROM goose_db_version WHERE version_id>=20261126000000`)
			ctx := context.Background()
			snapshot := filepath.Join(t.TempDir(), adminBackupName)
			require.NoError(t, f.api.writeVerifiedSnapshot(ctx, snapshot))
			db, err := os.ReadFile(snapshot)
			require.NoError(t, err)
			book, err := os.ReadFile("../_test_files/alice.epub")
			require.NoError(t, err)
			root := filepath.Join(f.cfg.DataPath, "documents")
			require.NoError(t, os.WriteFile(filepath.Join(root, "book.epub"), book, 0600))
			payload := db
			if format == "archive" {
				payload = zipStoragePaths(t, db, []string{"documents/library/./book.epub", "covers/./cover.png"}, book)
			}
			response := f.call("POST", "/api/v1/admin/restore", string(payload), map[string]string{"Content-Type": "application/octet-stream"})
			require.Equal(t, 200, response.status, string(response.body))
			candidate := decodeWeb[AdminRestore](t, response)
			response = f.call("PATCH", "/api/v1/admin/restore", AdminRestoreApply{Token: candidate.Token}, nil)
			require.Equal(t, 204, response.status, string(response.body))
			var path, cover string
			require.NoError(t, f.db.DB.QueryRow(`SELECT filepath,coverfile FROM documents WHERE id='legacy'`).Scan(&path, &cover))
			if format == "archive" {
				require.Equal(t, "restore-"+candidate.Token+"/library/book.epub", path)
				require.Equal(t, "restore-"+candidate.Token+"/cover.png", cover)
			} else {
				require.Equal(t, "book.epub", path)
				require.Equal(t, "cover.png", cover)
			}
			saved, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(path)))
			require.NoError(t, err)
			require.Equal(t, book, saved)
		})
	}
}

func TestStoragePathRestoreRejectsUnsafeEntries(t *testing.T) {
	for name, entries := range map[string][]string{
		"duplicate book":  {"documents/library/./book.epub", "documents/library/book.epub"},
		"duplicate cover": {"covers/./cover.png", "covers/cover.png"},
		"traversal":       {"documents/library/./a/../book.epub"},
		"absolute":        {"documents/library//book.epub"},
	} {
		t.Run(name, func(t *testing.T) {
			stage := t.TempDir()
			input := filepath.Join(t.TempDir(), "backup.zip")
			require.NoError(t, os.WriteFile(input, zipStoragePaths(t, []byte("snapshot"), entries, []byte("payload")), 0600))
			_, err := extractRestore(context.Background(), input, stage)
			require.Error(t, err)
		})
	}
}

func zipStoragePaths(t *testing.T, db []byte, entries []string, book []byte) []byte {
	t.Helper()
	var b bytes.Buffer
	archive := zip.NewWriter(&b)
	for _, name := range append([]string{adminBackupName}, entries...) {
		entry, err := archive.Create(name)
		require.NoError(t, err)
		data := book
		if name == adminBackupName {
			data = db
		}
		_, err = entry.Write(data)
		require.NoError(t, err)
	}
	require.NoError(t, archive.Close())
	return b.Bytes()
}
