package api

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/metadata"
)

func TestDocumentUploadStatus(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
	}{
		{metadata.ErrUnsupportedFileType, http.StatusUnsupportedMediaType},
		{metadata.ErrInvalidDocument, http.StatusBadRequest},
		{metadata.ErrArchiveTooLarge, http.StatusRequestEntityTooLarge},
		{fmt.Errorf("metadata: %w", metadata.ErrInvalidDocument), http.StatusBadRequest},
		{fmt.Errorf("disk failure"), http.StatusInternalServerError},
	} {
		require.Equal(t, tc.status, documentUploadStatus(tc.err))
	}
}

func TestUploadStagesBeforeAcquiringLibraryLock(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	started := make(chan struct{})
	resume := make(chan struct{})
	defer close(resume)
	req := httptest.NewRequest(http.MethodPost, f.server.URL+"/api/v1/documents", uploadStagingProbe{started, resume})
	req.Header.Set("Content-Type", "application/epub+zip")
	req.Header.Set("Origin", f.cfg.PublicOrigin)
	req.Header.Set("X-CSRF-Token", f.csrf)
	for _, cookie := range f.client.Jar.Cookies(req.URL) {
		req.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		defer close(done)
		f.api.Handler().ServeHTTP(response, req)
	}()
	select {
	case <-started:
	case <-done:
		t.Fatalf("upload returned before reading: %d %s", response.Code, response.Body)
	case <-time.After(3 * time.Second):
		t.Fatal("upload did not start staging")
	}
	acquired := f.api.libraryWrite.TryLock()
	if acquired {
		f.api.libraryWrite.Unlock()
	}
	resume <- struct{}{}
	<-done
	require.True(t, acquired, "body staging must not hold the Library write lock")
	require.Equal(t, 400, response.Code, response.Body.String())
	files, err := filepath.Glob(filepath.Join(f.cfg.ConfigPath, ".upload-*.epub"))
	require.NoError(t, err)
	require.Empty(t, files)
}

type uploadStagingProbe struct {
	started chan<- struct{}
	resume  <-chan struct{}
}

func (p uploadStagingProbe) Read([]byte) (int, error) {
	close(p.started)
	<-p.resume
	return 0, io.EOF
}

func TestRejectedUploadLeavesNoFileOrCatalogEntry(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	var invalidEPUB bytes.Buffer
	z := zip.NewWriter(&invalidEPUB)
	entry, err := z.Create("mimetype")
	require.NoError(t, err)
	_, err = entry.Write([]byte("application/epub+zip"))
	require.NoError(t, err)
	require.NoError(t, z.Close())

	headers := map[string]string{"Content-Type": "application/epub+zip"}
	assertProblem(t, f.call("POST", "/api/v1/documents", "not an EPUB", headers), 415, "invalid_request")
	assertProblem(t, f.call("POST", "/api/v1/documents", invalidEPUB.String(), headers), 400, "invalid_request")
	require.Zero(t, f.count("documents"))
	files, err := os.ReadDir(filepath.Join(f.cfg.DataPath, "documents"))
	require.NoError(t, err)
	require.Empty(t, files)
}
