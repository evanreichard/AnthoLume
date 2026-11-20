package api

import (
	"archive/zip"
	"bytes"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"

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
