package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestAutoImportScheduleAndWatch(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	f.exec(`UPDATE users SET admin=1 WHERE id='owner'`)
	endpoint := "/api/v1/admin/auto-import"
	config := AdminAutoImportSettings{Name: "Inbox", RootId: importsRoot, Reference: true, Enabled: true, Watch: true, IntervalMinutes: 20}
	dir := filepath.Join(f.cfg.DataPath, "imports")
	out := f.call("PUT", endpoint, config, nil)
	require.Equal(t, 204, out.status, string(out.body))
	list := f.call("GET", endpoint, nil, nil)
	require.Equal(t, 200, list.status)
	rules := decodeWeb[[]AdminAutoImport](t, list)
	require.Len(t, rules, 1)
	id := rules[0].Id
	query := endpoint + "?id=" + id
	assertProblem(t, f.call("PUT", endpoint, config, nil), 409, "auto_import_overlap")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); f.api.RunAutoImports(ctx) }()
	defer func() { cancel(); <-done }()
	read := func() AdminAutoImport {
		response := f.call("GET", endpoint, nil, nil)
		require.Equal(t, 200, response.status, string(response.body))
		return decodeWeb[[]AdminAutoImport](t, response)[0]
	}
	require.Eventually(t, func() bool { return read().LastScan != nil }, 8*time.Second, 150*time.Millisecond)
	current := read()
	require.Equal(t, config, current.Settings)
	require.EqualValues(t, "complete", current.Status)
	last, err := time.Parse(time.RFC3339, *current.LastScan)
	require.NoError(t, err)
	next, err := time.Parse(time.RFC3339, *current.NextScan)
	require.NoError(t, err)
	require.Equal(t, 20*time.Minute, next.Sub(last))
	require.Zero(t, f.count("documents"))
	book, err := os.ReadFile("../_test_files/alice.epub")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "new.epub"), book, 0600))
	require.Eventually(t, func() bool { return f.count("documents") == 1 }, 12*time.Second, 200*time.Millisecond)
	var root, path string
	require.NoError(t, f.db.DB.QueryRow(`SELECT storage_root_id,filepath FROM documents`).Scan(&root, &path))
	require.Equal(t, importsRoot, root)
	require.Equal(t, "new.epub", path)
	require.NoError(t, os.Rename(dir, dir+"-offline"))
	queued := f.call("POST", query, map[string]any{}, nil)
	require.Equal(t, 204, queued.status, string(queued.body))
	require.Eventually(t, func() bool { return read().Status == "unavailable" }, 8*time.Second, 150*time.Millisecond)
	require.Equal(t, 1, f.count("documents"))
}
