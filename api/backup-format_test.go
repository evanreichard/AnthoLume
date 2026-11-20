package api

import (
	"archive/zip"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestBackupArchiveLimits(t *testing.T) {
	var budget backupArchiveBudget
	require.Error(t, budget.add(adminBackupName, maxAdminBackupBytes+1))
	require.NoError(t, budget.add(adminBackupName, maxAdminBackupBytes))
	require.NoError(t, budget.add("covers/cover.png", maxLibraryBackup-maxAdminBackupBytes))
	require.Error(t, budget.add("documents/library/book.epub", 1))
	budget = backupArchiveBudget{entries: maxBackupEntries - 1}
	require.NoError(t, budget.add("covers/last.png", 0))
	require.Error(t, budget.add("covers/extra.png", 0))
}

func TestFullBackupRejectsConcurrentLibraryWriteWithoutBlockingReadingOrSync(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	book := []byte("synthetic book fixture")
	require.NoError(t, os.WriteFile(filepath.Join(f.cfg.DataPath, "documents", "book.epub"), book, 0600))
	f.exec(`UPDATE documents SET filepath='book.epub',storage_root_id='library' WHERE id='book-a'`)
	f.exec(`UPDATE users SET admin=1 WHERE id='alice'`)
	f.api.libraryWrite.Lock()
	defer f.api.libraryWrite.Unlock()
	f.client.Timeout = 2 * time.Second
	assertProblem(t, f.call("GET", "/api/v1/admin/backup?full=true", nil, nil), 409, "server_busy")
	file := f.call("GET", "/api/v1/documents/book-a/file", nil, nil)
	require.Equal(t, 200, file.status)
	require.Equal(t, book, file.body)
	response := f.call("POST", "/api/v1/me/reading-progress", progressPayload("0", .25), nil)
	require.Equal(t, 200, response.status, string(response.body))
	assertProblem(t, f.call("PATCH", "/api/v1/documents/book-a", DocumentEdit{Title: "changed"}, nil), 409, "server_busy")
}

func TestStartupRestoreInstallsLibraryOnlyIntoFreshInstance(t *testing.T) {
	source := newWebFixture(t)
	source.register("source-admin")
	book := []byte("startup restore fixture")
	require.NoError(t, os.WriteFile(filepath.Join(source.cfg.DataPath, "documents", "book.epub"), book, 0600))
	source.exec(`INSERT INTO documents(id,title,filepath,storage_root_id) VALUES('book','Book','book.epub','library')`)
	ctx := context.Background()
	dir := filepath.Join(t.TempDir(), "export")
	require.NoError(t, source.api.createFullBackup(ctx, dir))
	backup, err := os.Open(filepath.Join(dir, fullBackupName))
	require.NoError(t, err)
	defer backup.Close()

	dest := newWebFixture(t)
	require.NoError(t, dest.api.RestoreFreshInstance(ctx, backup))
	var restoredPath string
	require.NoError(t, dest.db.DB.QueryRow(`SELECT filepath FROM documents WHERE id='book'`).Scan(&restoredPath))
	actual, err := os.ReadFile(filepath.Join(dest.cfg.DataPath, "documents", filepath.FromSlash(restoredPath)))
	require.NoError(t, err)
	require.Equal(t, book, actual)
	require.ErrorContains(t, dest.api.RestoreFreshInstance(ctx, backup), "requires a fresh database")
}

func TestFullBackupRoundTripsNearLimitPaths(t *testing.T) {
	ctx := context.Background()
	source := newWebFixture(t)
	source.register("owner")
	type asset struct {
		id, book, cover string
	}
	nearLimit := func(prefix, dir, base string, delta int) string {
		return dir + "/" + strings.Repeat("b", maxBackupEntryPath+delta-len(prefix+dir+"//"+base)) + "/" + base
	}
	books := []asset{
		{"first", nearLimit("documents/library/", strings.Repeat("a", 245), "book.epub", 0), nearLimit("covers/", strings.Repeat("a", 245), "cover.jpg", 0)},
		{"second", nearLimit("documents/library/", strings.Repeat("z", 245), "book.epub", 1), nearLimit("covers/", strings.Repeat("z", 245), "cover.jpg", 1)},
	}
	for _, a := range books {
		for folder, name := range map[string]string{"documents": a.book, "covers": a.cover} {
			file := filepath.Join(source.cfg.DataPath, folder, filepath.FromSlash(name))
			require.NoError(t, os.MkdirAll(filepath.Dir(file), 0700))
			require.NoError(t, os.WriteFile(file, []byte(a.id+folder), 0600))
		}
		source.exec(`INSERT INTO documents(id,filepath,storage_root_id,coverfile) VALUES(?,?,'library',?)`, a.id, a.book, a.cover)
	}
	var previousNames []string
	for cycle := range 3 {
		dir := filepath.Join(t.TempDir(), "export")
		require.NoError(t, source.api.createFullBackup(ctx, dir))
		name := filepath.Join(dir, fullBackupName)
		archive, err := zip.OpenReader(name)
		require.NoError(t, err)
		var names []string
		for _, entry := range archive.File {
			require.LessOrEqual(t, len(entry.Name), maxBackupEntryPath)
			if entry.Name != adminBackupName {
				names = append(names, entry.Name)
			}
		}
		if cycle == 0 {
			snapshot, err := archive.Open(adminBackupName)
			require.NoError(t, err)
			data, err := io.ReadAll(snapshot)
			require.NoError(t, snapshot.Close())
			require.NoError(t, err)
			catalog := openExportedCatalog(t, data)
			var book, cover string
			require.NoError(t, catalog.QueryRow(`SELECT filepath,coverfile FROM documents WHERE id='second'`).Scan(&book, &cover))
			require.NotEqual(t, books[1].book, book)
			require.NotEqual(t, books[1].cover, cover)
			require.Contains(t, names, "documents/library/"+book)
			require.Contains(t, names, "covers/"+cover)
		}
		require.NoError(t, archive.Close())
		require.Len(t, names, 4)
		if cycle == 2 {
			require.ElementsMatch(t, previousNames, names, "another restore must not change packed paths")
		}
		previousNames = names

		backup, err := os.Open(name)
		require.NoError(t, err)
		dest := newWebFixture(t)
		err = dest.api.RestoreFreshInstance(ctx, backup)
		require.NoError(t, backup.Close())
		require.NoError(t, err)
		for i, a := range books {
			var before asset
			require.NoError(t, source.db.DB.QueryRow(`SELECT filepath,coverfile FROM documents WHERE id=?`, a.id).Scan(&before.book, &before.cover))
			require.Equal(t, a.book, before.book, "backup must not rewrite the live catalog")
			require.Equal(t, a.cover, before.cover)
			require.NoError(t, dest.db.DB.QueryRow(`SELECT filepath,coverfile FROM documents WHERE id=?`, a.id).Scan(&books[i].book, &books[i].cover))
			for folder, name := range map[string]string{"documents": books[i].book, "covers": books[i].cover} {
				bytes, err := os.ReadFile(filepath.Join(dest.cfg.DataPath, folder, filepath.FromSlash(name)))
				require.NoError(t, err)
				require.Equal(t, a.id+folder, string(bytes))
			}
		}
		source = dest
	}
}

func TestRestoreUpgradedFullBackupOnFreshInstance(t *testing.T) {
	source := newWebFixture(t)
	source.register("source-admin")
	book, err := os.ReadFile("../_test_files/alice.epub")
	require.NoError(t, err)
	library := filepath.Join(source.cfg.DataPath, "documents")
	require.NoError(t, os.WriteFile(filepath.Join(library, "book.epub"), book, 0600))

	// Recreate the layout from an installation where Goose added basepath and the new root column.
	source.exec(`ALTER TABLE documents DROP COLUMN storage_root_id;
 ALTER TABLE documents DROP COLUMN basepath;
 ALTER TABLE documents ADD COLUMN basepath TEXT;
 DROP TABLE auto_import_rules;
 DROP TABLE storage_roots;
 DELETE FROM goose_db_version WHERE version_id>=20261126000000;
 INSERT INTO documents(id,title,filepath,basepath) VALUES('legacy','Legacy book','book.epub',?)`, library)
	require.NoError(t, source.db.Reload(context.Background()))
	dir := filepath.Join(t.TempDir(), "export")
	require.NoError(t, source.api.createFullBackup(context.Background(), dir))
	payload, err := os.ReadFile(filepath.Join(dir, fullBackupName))
	require.NoError(t, err)

	dest := newWebFixture(t)
	dest.register("destination-admin")
	response := dest.call("POST", "/api/v1/admin/restore", string(payload), map[string]string{"Content-Type": "application/octet-stream"})
	require.Equal(t, 200, response.status, string(response.body))
	candidate := decodeWeb[AdminRestore](t, response)
	require.Equal(t, 1, candidate.Files)
	response = dest.call("PATCH", "/api/v1/admin/restore", AdminRestoreApply{Token: candidate.Token}, nil)
	require.Equal(t, 204, response.status, string(response.body))
	var restoredPath string
	require.NoError(t, dest.db.DB.QueryRow(`SELECT filepath FROM documents WHERE id='legacy'`).Scan(&restoredPath))
	actual, err := os.ReadFile(filepath.Join(dest.cfg.DataPath, "documents", filepath.FromSlash(restoredPath)))
	require.NoError(t, err)
	require.Equal(t, book, actual)
}
