package main

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPrepareFreshLibraryAndReuseWithoutOverwriting(t *testing.T) {
	data := t.TempDir()
	ctx := context.Background()
	require.NoError(t, run(ctx, data, "prepare", "", ""))
	path := filepath.Join(data, "dev", "antholume.db")
	db, err := sql.Open("sqlite", path)
	require.NoError(t, err)
	var n int
	require.NoError(t, db.QueryRow("SELECT count(*) FROM users").Scan(&n))
	require.Zero(t, n)
	_, err = db.Exec(`INSERT INTO documents(id,title) VALUES('kept','Existing library')`)
	require.NoError(t, err)
	require.NoError(t, db.Close())
	require.NoError(t, run(ctx, data, "prepare", "", ""))
	require.ErrorContains(t, run(ctx, data, "prepare", path, ""), "already exists")
	db, err = sql.Open("sqlite", path)
	require.NoError(t, err)
	defer db.Close()
	var title string
	require.NoError(t, db.QueryRow("SELECT title FROM documents WHERE id='kept'").Scan(&title))
	require.Equal(t, "Existing library", title)
}

func TestPrepareLeavesIncompleteExistingDirectoryAlone(t *testing.T) {
	data := t.TempDir()
	root := filepath.Join(data, "dev")
	require.NoError(t, os.Mkdir(root, 0700))
	require.ErrorContains(t, run(context.Background(), data, "prepare", "", ""), "incomplete dev state")
	require.DirExists(t, root)
	require.NoFileExists(t, filepath.Join(root, "antholume.db"))
}
