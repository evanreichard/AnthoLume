package api

import (
	"context"
	"os"
	"path/filepath"
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

func TestFullBackupDoesNotBlockReadingOrSync(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	book := []byte("synthetic book fixture")
	require.NoError(t, os.WriteFile(filepath.Join(f.cfg.DataPath, "documents", "book.epub"), book, 0600))
	f.exec(`UPDATE documents SET filepath='book.epub',storage_root_id='library' WHERE id='book-a'`)
	started, release := make(chan struct{}), make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		finished <- f.api.runAdminWork(context.Background(), "full_backup", func(ctx context.Context) error {
			close(started)
			<-release
			return f.api.createFullBackup(ctx)
		})
	}()
	t.Cleanup(func() {
		close(release)
		select {
		case err := <-finished:
			require.NoError(t, err)
		case <-time.After(10 * time.Second):
			t.Error("backup did not finish")
		}
	})
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("backup did not start")
	}
	f.client.Timeout = 2 * time.Second
	file := f.call("GET", "/api/v1/documents/book-a/file", nil, nil)
	require.Equal(t, 200, file.status)
	require.Equal(t, book, file.body)
	response := f.call("POST", "/api/v1/me/reading-progress", progressPayload("0", .25), nil)
	require.Equal(t, 200, response.status, string(response.body))
	assertProblem(t, f.call("PATCH", "/api/v1/documents/book-a", DocumentEdit{Title: "changed"}, nil), 409, "server_busy")
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
 DROP TABLE storage_roots;
 DELETE FROM goose_db_version WHERE version_id>=20261126000000;
 INSERT INTO documents(id,title,filepath,basepath) VALUES('legacy','Legacy book','book.epub',?)`, library)
	require.NoError(t, source.db.Reload(context.Background()))
	require.NoError(t, source.api.createFullBackup(context.Background()))
	payload, err := os.ReadFile(filepath.Join(source.api.adminBackupDir(), fullBackupName))
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
