package api

import (
	"archive/zip"
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestStoragePathStartupRepairAndBackup(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	book, err := os.ReadFile("../_test_files/alice.epub")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(f.cfg.DataPath, "documents", "book.epub"), book, 0600))
	f.exec(`UPDATE users SET admin=1 WHERE id='owner'; INSERT INTO documents(id,filepath,storage_root_id,deleted) VALUES ('legacy','./book.epub','library',FALSE),('unsafe','./../book.epub','library',TRUE); DROP TABLE auto_import_rules; DELETE FROM goose_db_version WHERE version_id>=20261126000000`)
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
	for _, endpoint := range []string{adminBackupEndpoint + "/preview", adminBackupEndpoint, adminBackupEndpoint + "?full=true"} {
		response := f.call("GET", endpoint, nil, nil)
		assertProblem(t, response, 409, "invalid_backup_catalog")
		require.Equal(t, &AdminBackupPathIssue{DocumentId: "unsafe", Kind: Book}, decodeWeb[Problem](t, response).BackupPathIssue)
		require.Empty(t, response.header.Get("Content-Disposition"))
	}
	confirm := true
	repair := "/api/v1/admin/backup/repair-path"
	assertProblem(t, f.call("POST", repair, AdminBackupPathRepair{DocumentId: "unsafe", Kind: Book}, nil), 400, "invalid_request")
	require.Equal(t, 204, f.call("POST", repair, AdminBackupPathRepair{DocumentId: "unsafe", Kind: Book, ConfirmClear: &confirm}, nil).status)
	for _, format := range []string{"database", "archive"} {
		t.Run(format, func(t *testing.T) {
			endpoint := adminBackupEndpoint
			if format == "archive" {
				endpoint += "?full=true"
			}
			response := f.call("GET", endpoint, nil, nil)
			require.Equal(t, 200, response.status, string(response.body))
			dest := newWebFixture(t)
			require.NoError(t, dest.api.RestoreFreshInstance(context.Background(), bytes.NewReader(response.body)))
			var preserved bool
			require.NoError(t, dest.db.DB.QueryRow(`SELECT deleted AND filepath IS NULL AND storage_root_id IS NULL FROM documents WHERE id='unsafe'`).Scan(&preserved))
			require.True(t, preserved)
			var restored string
			require.NoError(t, dest.db.DB.QueryRow(`SELECT filepath FROM documents WHERE id='legacy'`).Scan(&restored))
			if format == "archive" {
				actual, err := os.ReadFile(filepath.Join(dest.cfg.DataPath, "documents", filepath.FromSlash(restored)))
				require.NoError(t, err)
				require.Equal(t, book, actual)
			} else {
				require.Equal(t, "book.epub", restored)
			}
		})
	}
}

func TestReferenceImportRejectsNonportableCatalogPath(t *testing.T) {
	f := newWebFixture(t)
	source := t.TempDir()
	name := `old\name.epub`
	book, err := os.ReadFile("../_test_files/alice.epub")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(source, name), book, 0600))
	root, err := os.OpenRoot(source)
	require.NoError(t, err)
	defer root.Close()
	status, err := f.api.importBook(context.Background(), root, AdminStorageRoot{Id: libraryRoot, Path: source}, name, true, false)
	require.ErrorContains(t, err, "invalid reference path")
	require.Equal(t, AdminImportResultStatus("failed"), status)
	var count int
	require.NoError(t, f.db.DB.QueryRow(`SELECT COUNT(*) FROM documents`).Scan(&count))
	require.Zero(t, count)
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
			bookPath := filepath.Join(root, "book.epub")
			require.NoError(t, os.WriteFile(bookPath, book, 0600))
			mtime := time.Unix(123456789, 0)
			require.NoError(t, os.Chtimes(bookPath, mtime, mtime))
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
			require.Equal(t, "book.epub", path)
			require.Equal(t, "cover.png", cover)
			saved, err := os.ReadFile(bookPath)
			require.NoError(t, err)
			require.Equal(t, book, saved)
			info, err := os.Stat(bookPath)
			require.NoError(t, err)
			require.True(t, info.ModTime().Equal(mtime), "an existing matching book must not be rewritten")
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
			_, err := extractRestore(context.Background(), input, stage, nil)
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
