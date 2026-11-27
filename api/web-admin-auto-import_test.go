package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestAutoImportWatchAndManualScan(t *testing.T) {
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
	require.Equal(t, new(Initial), current.LastScanTrigger)
	require.EqualValues(t, "complete", current.Status)
	require.Nil(t, current.NextScan)
	require.Equal(t, &AutoImportScanSummary{}, current.ScanSummary)
	require.Zero(t, f.count("documents"))
	book, err := os.ReadFile("../_test_files/alice.epub")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "new.epub"), book, 0600))
	completed := func(trigger AutoImportScanTrigger) bool {
		rule := read()
		return rule.Status == "complete" && rule.LastScanTrigger != nil && *rule.LastScanTrigger == trigger
	}
	require.Eventually(t, func() bool { return completed(OnChange) }, 12*time.Second, 200*time.Millisecond)
	current = read()
	require.Nil(t, current.NextScan)
	require.Equal(t, new(OnChange), current.LastScanTrigger)
	require.Equal(t, &AutoImportScanSummary{BooksAdded: 1, SourceTotal: 1}, current.ScanSummary)
	require.Equal(t, 1, f.count("documents"))
	var root, path string
	require.NoError(t, f.db.DB.QueryRow(`SELECT storage_root_id,filepath FROM documents`).Scan(&root, &path))
	require.Equal(t, importsRoot, root)
	require.Equal(t, "new.epub", path)
	f.exec(`INSERT INTO documents (id, title) VALUES ('another-book', 'Not in source')`)
	queued := f.call("POST", query, map[string]any{}, nil)
	require.Equal(t, 204, queued.status, string(queued.body))
	require.Eventually(t, func() bool { return completed(Manual) }, 8*time.Second, 150*time.Millisecond)
	current = read()
	require.Equal(t, new(Manual), current.LastScanTrigger)
	require.Equal(t, &AutoImportScanSummary{SourceTotal: 1}, current.ScanSummary)
	require.NoError(t, os.Rename(dir, dir+"-offline"))
	queued = f.call("POST", query, map[string]any{}, nil)
	require.Equal(t, 204, queued.status, string(queued.body))
	require.Eventually(t, func() bool { return read().Status == "unavailable" }, 8*time.Second, 150*time.Millisecond)
	current = read()
	require.Nil(t, current.NextScan)
	require.Equal(t, new(Manual), current.LastScanTrigger)
	require.Nil(t, current.ScanSummary)
	require.Equal(t, 2, f.count("documents"))
}

func TestAutoImportReportsLatestFileErrors(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	f.exec(`UPDATE users SET admin=1 WHERE id='owner'`)
	endpoint := "/api/v1/admin/auto-import"
	config := AdminAutoImportSettings{Name: "Inbox", RootId: importsRoot, Reference: true, Enabled: true, IntervalMinutes: 60}
	require.Equal(t, 204, f.call("PUT", endpoint, config, nil).status)
	read := func() AdminAutoImport {
		return decodeWeb[[]AdminAutoImport](t, f.call("GET", endpoint, nil, nil))[0]
	}
	id := read().Id
	dir := filepath.Join(f.cfg.DataPath, "imports")
	files := []string{"broken-one.epub", "broken-two.epub"}
	for _, name := range files {
		path := filepath.Join(dir, name)
		require.NoError(t, os.WriteFile(path, []byte("not an epub"), 0600))
		old := time.Now().Add(-time.Minute)
		require.NoError(t, os.Chtimes(path, old, old))
	}
	cache := make(map[string]autoImportCache)
	require.True(t, f.api.runAutoImport(context.Background(), id, false, cache))
	rule := read()
	require.EqualValues(t, "errors", rule.Status)
	require.NotNil(t, rule.ScanSummary.Errors)
	var failed []string
	for _, failure := range *rule.ScanSummary.Errors {
		require.NotEmpty(t, failure.Reason)
		failed = append(failed, failure.File)
	}
	require.ElementsMatch(t, files, failed)
	for _, name := range files {
		require.NoError(t, os.Remove(filepath.Join(dir, name)))
	}
	require.Equal(t, 204, f.call("POST", endpoint+"?id="+id, map[string]any{}, nil).status)
	require.True(t, f.api.runAutoImport(context.Background(), id, false, cache))
	require.Equal(t, &AutoImportScanSummary{}, read().ScanSummary)
}

func TestAutoImportIntervalSchedulesNextScan(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	f.exec(`UPDATE users SET admin=1 WHERE id='owner'`)
	endpoint := "/api/v1/admin/auto-import"
	config := AdminAutoImportSettings{Name: "Inbox", RootId: importsRoot, Reference: true, Enabled: true, IntervalMinutes: 60}
	out := f.call("PUT", endpoint, config, nil)
	require.Equal(t, 204, out.status, string(out.body))
	read := func() AdminAutoImport {
		return decodeWeb[[]AdminAutoImport](t, f.call("GET", endpoint, nil, nil))[0]
	}
	caches := make(map[string]autoImportCache)
	require.True(t, f.api.runAutoImport(context.Background(), read().Id, false, caches))
	current := read()
	require.NotNil(t, current.LastScan)
	require.NotNil(t, current.NextScan)
	last, err := time.Parse(time.RFC3339, *current.LastScan)
	require.NoError(t, err)
	next, err := time.Parse(time.RFC3339, *current.NextScan)
	require.NoError(t, err)
	require.Equal(t, time.Hour, next.Sub(last))
	require.Equal(t, new(Initial), current.LastScanTrigger)

	f.exec(`UPDATE auto_import_rules SET next_scan='2000-01-01T00:00:00.000Z' WHERE id=?`, current.Id)
	require.True(t, f.api.runAutoImport(context.Background(), current.Id, false, caches))
	require.Equal(t, new(Scheduled), read().LastScanTrigger)
}
