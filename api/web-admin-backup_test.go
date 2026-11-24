package api

import (
	"database/sql"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const adminBackupEndpoint = "/api/v1/admin/backup"

func TestAdminBackupRejectsOverlappingDownloads(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	f.exec(`UPDATE users SET admin=1 WHERE id='owner'`)

	request := httptest.NewRequest("GET", f.server.URL+adminBackupEndpoint+"?full=true", nil)
	for _, cookie := range f.client.Jar.Cookies(request.URL) {
		request.AddCookie(cookie)
	}
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	response := &pausedBackupResponse{httptest.NewRecorder(), started, release}
	go func() {
		defer close(done)
		f.api.Handler().ServeHTTP(response, request)
	}()
	t.Cleanup(func() {
		close(release)
		<-done
		temporary, err := filepath.Glob(filepath.Join(f.cfg.ConfigPath, ".backup-export-*"))
		require.NoError(t, err)
		require.Empty(t, temporary)
	})
	select {
	case <-started:
		require.Equal(t, 200, response.Code, "the first response must be streaming a backup")
	case <-done:
		t.Fatalf("download finished before streaming: HTTP %d", response.Code)
	case <-time.After(5 * time.Second):
		t.Fatal("download did not start streaming")
	}
	assertProblem(t, f.call("GET", adminBackupEndpoint, nil, nil), 409, "server_busy")
}

type pausedBackupResponse struct {
	*httptest.ResponseRecorder
	started chan struct{}
	release chan struct{}
}

func (w *pausedBackupResponse) Write(p []byte) (int, error) {
	select {
	case <-w.started:
	default:
		close(w.started)
		<-w.release
	}
	return w.ResponseRecorder.Write(p)
}

func TestFailedFullBackupLeavesNoExportAndAllowsRetry(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	f.exec(`UPDATE users SET admin=1 WHERE id='owner'`)

	covers := filepath.Join(f.cfg.DataPath, "covers")
	require.NoError(t, os.Remove(covers))
	response := f.call("GET", adminBackupEndpoint+"?full=true", nil, nil)
	require.Equal(t, 500, response.status, string(response.body))
	require.Empty(t, response.header.Get("Content-Disposition"))
	temporary, err := filepath.Glob(filepath.Join(f.cfg.ConfigPath, ".backup-export-*"))
	require.NoError(t, err)
	require.Empty(t, temporary)

	require.NoError(t, os.Mkdir(covers, 0700))
	retry := f.call("GET", adminBackupEndpoint+"?full=true", nil, nil)
	require.Equal(t, 200, retry.status, string(retry.body))
}

func TestDatabaseBackupReflectsLatestCatalog(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	f.exec(`UPDATE users SET admin=1 WHERE id='owner'`)
	f.exec(`INSERT INTO documents(id,title) VALUES('book','First title')`)
	marker := []byte("synthetic Hardcover ciphertext in the live database")
	f.exec(`INSERT INTO hardcover_links SELECT account_id, ? FROM account_identities WHERE user_id='owner'`, marker)
	checkTitle := func(want string) {
		t.Helper()
		response := f.call("GET", adminBackupEndpoint, nil, nil)
		require.Equal(t, 200, response.status, string(response.body))
		require.NotContains(t, string(response.body), string(marker))
		require.Equal(t, 1, f.count("hardcover_links"))
		catalog := openExportedCatalog(t, response.body)
		var title string
		require.NoError(t, catalog.QueryRow(`SELECT title FROM documents WHERE id='book'`).Scan(&title))
		require.Equal(t, want, title)
	}
	checkTitle("First title")
	f.exec(`UPDATE documents SET title='Updated title' WHERE id='book'`)
	checkTitle("Updated title")
}

func openExportedCatalog(t *testing.T, data []byte) *sql.DB {
	t.Helper()
	name := filepath.Join(t.TempDir(), adminBackupName)
	require.NoError(t, os.WriteFile(name, data, 0600))
	catalog, err := sql.Open("sqlite", snapshotURI(name))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, catalog.Close()) })
	return catalog
}
