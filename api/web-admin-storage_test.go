package api

import (
	"archive/zip"
	"bytes"
	"context"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNamedStorageRootsImportRemapAndBackup(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	f.exec(`UPDATE users SET admin=0 WHERE id='owner'`)
	rootsURL := "/api/v1/admin/storage-roots"
	directoriesURL := "/api/v1/admin/storage-directories"
	assertProblem(t, f.call("GET", directoriesURL, nil, nil), 403, "forbidden")
	assertProblem(t, f.call("GET", rootsURL, nil, nil), 403, "forbidden")
	f.exec(`UPDATE users SET admin=1 WHERE id='owner'`)
	parent := t.TempDir()
	external := filepath.Join(parent, "original")
	moved := filepath.Join(parent, "moved")
	managed := filepath.Join(parent, "managed")
	require.NoError(t, os.MkdirAll(filepath.Join(external, "authors"), 0700))
	require.NoError(t, os.Mkdir(managed, 0700))
	book, err := os.ReadFile("../_test_files/alice.epub")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(external, "authors", "alice.epub"), book, 0600))
	listing := f.call("GET", directoriesURL+"?path="+url.QueryEscape(parent), nil, nil)
	require.Equal(t, 200, listing.status, string(listing.body))
	require.Equal(t, []string{"managed", "original"}, decodeWeb[AdminStorageDirectories](t, listing).Entries)
	setRoot := func(id, path string) {
		t.Helper()
		result := f.call("PUT", rootsURL, AdminStorageRootInput{Id: id, Label: id, Path: path}, nil)
		require.Equal(t, 204, result.status, string(result.body))
	}
	setRoot("external", external)
	setRoot(libraryRoot, managed)
	require.NoError(t, f.db.Reload(context.Background()))
	lib, err := f.api.storageRoot(context.Background(), libraryRoot)
	require.NoError(t, err)
	require.True(t, lib.Managed)
	require.Equal(t, managed, lib.Path)
	assertProblem(t, f.call("PUT", rootsURL, map[string]any{"id": "other", "label": "Other", "path": external, "managed": true}, nil), 400, "invalid_request")
	assertProblem(t, f.call("GET", "/api/v1/admin/import?root_id=library", nil, nil), 400, "invalid_import_source")
	assertProblem(t, f.call("POST", "/api/v1/admin/jobs", map[string]any{"kind": "import", "root_id": "external", "destination_root_id": "external"}, nil), 400, "invalid_request")
	require.NoError(t, os.Symlink(managed, filepath.Join(external, "outside")))
	require.Zero(t, f.count("admin_jobs"))
	preview := f.call("GET", "/api/v1/admin/import?root_id=external", nil, nil)
	require.Equal(t, 200, preview.status, string(preview.body))
	require.Equal(t, []string{"authors/alice.epub"}, decodeWeb[[]string](t, preview))
	ctx := context.Background()
	root, err := os.OpenRoot(external)
	require.NoError(t, err)
	storage, err := f.api.storageRoot(ctx, "external")
	require.NoError(t, err)
	status, err := f.api.importBook(ctx, root, storage, "authors/alice.epub", true, false)
	root.Close()
	require.NoError(t, err)
	require.EqualValues(t, "imported", status)
	var id, relative string
	require.NoError(t, f.db.DB.QueryRow(`SELECT id,filepath FROM documents WHERE storage_root_id='external'`).Scan(&id, &relative))
	require.Equal(t, "authors/alice.epub", relative)
	fileURL := "/api/v1/documents/" + id + "/file"
	require.Equal(t, book, f.call("GET", fileURL, nil, nil).body)
	require.NoError(t, os.Rename(external, moved))
	available := map[string]bool{}
	for _, root := range decodeWeb[[]AdminStorageRoot](t, f.call("GET", rootsURL, nil, nil)) {
		available[root.Id] = root.DirectoryAvailable
	}
	require.Contains(t, available, "external")
	require.False(t, available["external"])
	require.True(t, available[libraryRoot])
	assertProblem(t, f.call("GET", fileURL, nil, nil), 404, "not_found")
	setRoot("external", moved)
	require.Equal(t, book, f.call("GET", fileURL, nil, nil).body)

	require.NoError(t, os.WriteFile(filepath.Join(managed, "catalog.epub"), book, 0600))
	require.NoError(t, os.WriteFile(filepath.Join(managed, "untracked.epub"), book, 0600))
	f.exec(`INSERT INTO documents(id,filepath,storage_root_id) VALUES('copy','catalog.epub','library'),('missing','missing.epub','library')`)
	preview = f.call("GET", "/api/v1/admin/backup/preview", nil, nil)
	require.Equal(t, 200, preview.status, string(preview.body))
	require.Equal(t, AdminBackupPreview{Files: 1, Bytes: int64(len(book)), Missing: 1}, decodeWeb[AdminBackupPreview](t, preview))
	archive := f.call("GET", "/api/v1/admin/backup?full=true", nil, nil)
	require.Equal(t, 200, archive.status)
	require.Zero(t, f.count("admin_jobs"))
	temporary, err := filepath.Glob(filepath.Join(f.cfg.ConfigPath, ".backup-export-*"))
	require.NoError(t, err)
	require.Empty(t, temporary)
	zipped, err := zip.NewReader(bytes.NewReader(archive.body), int64(len(archive.body)))
	require.NoError(t, err)
	var entries []string
	for _, entry := range zipped.File {
		entries = append(entries, entry.Name)
	}
	require.ElementsMatch(t, []string{"antholume.db", "documents/library/catalog.epub"}, entries)
	response := f.call("POST", "/api/v1/admin/restore", string(archive.body), map[string]string{"Content-Type": "application/octet-stream"})
	require.Equal(t, 200, response.status, string(response.body))
	candidate := decodeWeb[AdminRestore](t, response)
	response = f.call("PATCH", "/api/v1/admin/restore", AdminRestoreApply{Token: candidate.Token}, nil)
	require.Equal(t, 204, response.status, string(response.body))
	var stored string
	require.NoError(t, f.db.DB.QueryRow(`SELECT filepath FROM documents WHERE id='copy' AND storage_root_id='library'`).Scan(&stored))
	data, err := os.ReadFile(filepath.Join(managed, filepath.FromSlash(stored)))
	require.NoError(t, err)
	require.Equal(t, book, data)
	require.NoError(t, f.db.DB.QueryRow(`SELECT filepath FROM documents WHERE id=? AND storage_root_id='external'`, id).Scan(&stored))
	require.Equal(t, "authors/alice.epub", stored)
	data, err = os.ReadFile(filepath.Join(moved, "authors", "alice.epub"))
	require.NoError(t, err)
	require.Equal(t, book, data)
}
