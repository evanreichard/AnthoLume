package api

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/metadata"
)

func TestDocumentUploadError(t *testing.T) {
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
		status, message := documentUploadError(tc.err)
		require.Equal(t, tc.status, status)
		require.NotEmpty(t, message)
	}
}
