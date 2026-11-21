package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRestoreCollisionPublishesOnlyWithCatalog(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	ctx := context.Background()
	stage := t.TempDir()
	library := filepath.Join(f.cfg.DataPath, "documents")
	f.exec(`INSERT INTO documents(id,filepath,storage_root_id) VALUES('collision','first.epub','library')`)
	require.NoError(t, f.api.writeVerifiedSnapshot(ctx, filepath.Join(stage, adminBackupName)))
	books := filepath.Join(stage, "documents", libraryRoot)
	require.NoError(t, os.MkdirAll(books, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(books, "first.epub"), []byte("snapshot"), 0600))
	live := filepath.Join(library, "first.epub")
	require.NoError(t, os.WriteFile(live, []byte("original"), 0600))
	// Later entry cannot be installed because its parent is a regular file.
	obstruction := filepath.Join(library, "z")
	require.NoError(t, os.WriteFile(obstruction, nil, 0600))
	require.NoError(t, os.Mkdir(filepath.Join(books, "z"), 0700))
	require.Error(t, f.api.applyStagedRestore(ctx, stage, library))
	require.NoError(t, os.Remove(obstruction))
	var path string
	readPath := func() {
		require.NoError(t, f.db.DB.QueryRow(`SELECT filepath FROM documents WHERE id='collision'`).Scan(&path))
	}
	readPath()
	require.Equal(t, "first.epub", path)
	require.NoError(t, f.api.applyStagedRestore(ctx, stage, library))
	readPath()
	require.NotEqual(t, "first.epub", path)
	restored, err := os.ReadFile(filepath.Join(library, path))
	require.NoError(t, err)
	require.Equal(t, "snapshot", string(restored))
	original, err := os.ReadFile(live)
	require.NoError(t, err)
	require.Equal(t, "original", string(original))
}
