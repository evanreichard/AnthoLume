package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io/fs"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/require"
)

func TestWebLibraryBinariesAndOPDSWire(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	external := t.TempDir()
	book, err := os.ReadFile("../_test_files/alice.epub")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(external, "original.epub"), book, 0600))
	cover, err := os.Create(filepath.Join(f.cfg.DataPath, "covers", "actual.png"))
	require.NoError(t, err)
	require.NoError(t, png.Encode(cover, image.NewRGBA(image.Rect(0, 0, 2, 2))))
	require.NoError(t, cover.Close())
	f.exec(`INSERT INTO storage_roots(id,label,path,managed) VALUES('external','External',?,0)`, external)
	f.exec(`INSERT INTO documents(id,title,author,description,storage_root_id,filepath,coverfile) VALUES('opaque-book','Literal %_ Title','Author','<script>untrusted text</script>','external','original.epub','actual.png')`)
	f.exec(`INSERT INTO documents(id,title) VALUES('z-book',NULL),('deleted','Deleted')`)
	f.exec("UPDATE documents SET deleted=1 WHERE id='deleted'")
	r := f.call("GET", "/api/v1/documents?page_size=1&q=%25_", nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	page := decodeWeb[DocumentPage](t, r)
	require.Equal(t, 1, page.Total)
	require.Len(t, page.Items, 1)
	require.Nil(t, page.NextPage)
	require.Equal(t, "opaque-book", page.Items[0].Id)
	doc := page.Items[0]
	require.True(t, doc.FileAvailable)
	require.True(t, doc.CoverAvailable)
	require.Equal(t, int64(len(book)), *doc.FileSizeBytes)
	require.Equal(t, "application/epub+zip", *doc.MediaType)
	require.Equal(t, "<script>untrusted text</script>", *doc.Description)
	require.NotContains(t, string(r.body), external)
	require.NotContains(t, string(r.body), "filepath")
	require.NotContains(t, string(r.body), "auth_hash")
	r = f.call("GET", "/api/v1/documents?page_size=1", nil, nil)
	page = decodeWeb[DocumentPage](t, r)
	require.Equal(t, 2, page.Total)
	require.Equal(t, 2, *page.NextPage)
	r = f.call("GET", "/api/v1/documents?page=2&page_size=1", nil, nil)
	page = decodeWeb[DocumentPage](t, r)
	require.Equal(t, "z-book", page.Items[0].Id)
	require.Nil(t, page.Items[0].Title)
	require.False(t, page.Items[0].FileAvailable)
	r = f.call("GET", "/api/v1/documents?page=3", nil, nil)
	require.Equal(t, []Document{}, decodeWeb[DocumentPage](t, r).Items)
	for _, path := range []string{"?page=0", "?page_size=101", "?page=no", "?q=" + strings.Repeat("x", 257)} {
		assertProblem(t, f.call("GET", "/api/v1/documents"+path, nil, nil), 400, "invalid_request")
	}
	assertProblem(t, f.call("GET", "/api/v1/documents/deleted", nil, nil), 404, "not_found")
	require.NoError(t, os.WriteFile(filepath.Join(f.cfg.DataPath, "documents", "managed.epub"), book, 0600))
	f.exec("INSERT INTO documents(id,filepath) VALUES('managed','managed.epub')")
	managed := f.call("GET", "/api/v1/documents/managed/file", nil, nil)
	require.Equal(t, 200, managed.status, string(managed.body))
	require.Equal(t, book, managed.body)
	require.Equal(t, "application/epub+zip", managed.header.Get("Content-Type"))
	r = f.call("GET", "/api/v1/documents/opaque-book/file", nil, nil)
	require.Equal(t, 200, r.status)
	require.Equal(t, book, r.body)
	require.Equal(t, "application/epub+zip", r.header.Get("Content-Type"))
	require.Equal(t, "private, no-store", r.header.Get("Cache-Control"))
	require.Contains(t, r.header.Get("Content-Disposition"), "attachment")
	require.Contains(t, r.header.Get("Content-Disposition"), "original.epub")
	require.Equal(t, int64(len(book)), r.headerContentLength(t))
	etag := r.header.Get("ETag")
	require.NotEmpty(t, etag)
	r = f.call("GET", "/api/v1/documents/opaque-book/file", nil, map[string]string{"Range": "bytes=4-15"})
	require.Equal(t, 206, r.status)
	require.Equal(t, book[4:16], r.body)
	require.Contains(t, r.header.Get("Content-Range"), "bytes 4-15/")
	r = f.call("GET", "/api/v1/documents/opaque-book/file", nil, map[string]string{"If-None-Match": etag})
	require.Equal(t, 304, r.status)
	require.Empty(t, r.body)
	assertProblem(t, f.call("GET", "/api/v1/documents/opaque-book/file", nil, map[string]string{"Range": "bytes=999999999-"}), 416, "invalid_request")
	r = f.call("GET", "/api/v1/documents/opaque-book/cover", nil, nil)
	require.Equal(t, 200, r.status)
	require.Equal(t, "image/png", r.header.Get("Content-Type"))
	require.Zero(t, f.count("metadata"))
	assertProblem(t, f.call("GET", "/api/v1/documents/z-book/cover", nil, nil), 404, "not_found")
	require.Zero(t, f.count("metadata"))
	f.exec("INSERT INTO documents(id,storage_root_id,filepath) VALUES('traversal','external','../secret.epub')")
	require.NoError(t, os.Symlink(filepath.Join(external, "original.epub"), filepath.Join(f.cfg.DataPath, "documents", "escape.epub")))
	f.exec("INSERT INTO documents(id,filepath) VALUES('symlink','escape.epub')")
	for _, id := range []string{"z-book", "missing", "traversal", "symlink"} {
		assertProblem(t, f.call("GET", "/api/v1/documents/"+id+"/file", nil, nil), 404, "not_found")
	}
	// OPDS remains its existing Basic-auth/XML protocol, independent of the JSON session's CSRF rules.
	r = f.call("GET", "/api/opds", nil, nil)
	require.Equal(t, 401, r.status)
	require.Equal(t, `Basic realm="restricted", charset="UTF-8"`, r.header.Get("WWW-Authenticate"))
	headers := map[string]string{"Authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte("alice:password"))}
	r = f.call("GET", "/api/opds", nil, headers)
	require.Equal(t, 200, r.status)
	require.Contains(t, r.header.Get("Content-Type"), "application/xml")
	require.Contains(t, string(r.body), "/api/opds/search.xml")
	require.Contains(t, string(r.body), "search={searchTerms}")
	require.Contains(t, string(r.body), "/api/opds/documents")
	r = f.call("GET", "/api/opds/documents", nil, headers)
	require.Equal(t, 200, r.status)
	require.Contains(t, string(r.body), "/api/opds/documents/opaque-book/file")
	require.Contains(t, string(r.body), "application/epub+zip")
	r = f.call("GET", "/api/opds/documents/opaque-book/file", nil, headers)
	require.Equal(t, 200, r.status)
	require.Equal(t, book, r.body)
	f.exec("UPDATE documents SET filepath='missing.epub' WHERE id='opaque-book'")
	assertProblem(t, f.call("GET", "/api/v1/documents/opaque-book/file", nil, nil), 404, "not_found")
}
func (r webResponse) headerContentLength(t *testing.T) int64 {
	t.Helper()
	var n int64
	_, err := fmt.Sscan(r.header.Get("Content-Length"), &n)
	require.NoError(t, err)
	return n
}

type overlayAssets struct {
	primary  fs.FS
	fallback fs.FS
}

func (o overlayAssets) Open(name string) (fs.File, error) {
	f, err := o.primary.Open(name)
	if err == nil {
		return f, nil
	}
	return o.fallback.Open(name)
}
func TestAppShellBoundaryAndRetirementBootstrap(t *testing.T) {
	f := newWebFixture(t)
	shell := `<!doctype html><html><body>compiled fixture</body></html>`
	assets := overlayAssets{fstest.MapFS{
		"assets/app/index.html":             {Data: []byte(shell)},
		"assets/app/sw.js":                  {Data: []byte("// compiled worker")},
		"assets/app/manifest.json":          {Data: []byte(`{"start_url":"/","scope":"/"}`)},
		"assets/app/assets/app-abcdefgh.js": {Data: []byte("// hashed chunk")},
	}, os.DirFS("..")}
	require.NoError(t, CheckAppAssets(assets))
	f.server.Close()
	f.server = httptest.NewUnstartedServer(nil)
	f.cfg.PublicOrigin = "http://" + f.server.Listener.Addr().String()
	api, err := NewAPI(f.db, f.cfg, assets)
	require.NoError(t, err)
	f.server.Config.Handler = api.Handler()
	f.server.Start()
	for _, path := range []string{"/app/", "/app/library", "/app/admin/library", "/app/admin/logs", "/app/insights", "/app/insights/activity", "/app/insights/progress", "/app/insights/rankings", "/app/offline", "/app/books/server/opaque-book", "/app/read/local/local-id", "/?antholume-retirement=legacy-v1"} {
		r := f.call("GET", path, nil, nil)
		require.Equal(t, 200, r.status, path)
		require.Equal(t, shell, string(r.body))
		require.Equal(t, "no-cache", r.header.Get("Cache-Control"))
		require.Equal(t, "DENY", r.header.Get("X-Frame-Options"))
		require.Contains(t, r.header.Get("Content-Security-Policy"), "object-src 'none'")
		require.NotContains(t, r.header.Get("Content-Security-Policy"), "frame-ancestors")
	}
	for _, path := range []string{"/app/unknown", "/app/assets/missing.js", "/assets/app/assets/missing.js", "/assets/app/index.html", "/api/v1/unknown", "/api/ko/no-such-route", "/api/opds/no-such-route"} {
		r := f.call("GET", path, nil, nil)
		require.Equal(t, 404, r.status, path)
		require.NotContains(t, string(r.body), "compiled fixture")
	}
	r := f.call("GET", "/assets/app/assets/app-abcdefgh.js", nil, nil)
	require.Equal(t, 200, r.status)
	require.Contains(t, r.header.Get("Cache-Control"), "immutable")
	r = f.call("GET", "/sw.js", nil, nil)
	require.Equal(t, 200, r.status)
	require.Equal(t, "// compiled worker", string(r.body))
	require.Contains(t, r.header.Get("Content-Type"), "javascript")
	require.Equal(t, "no-cache", r.header.Get("Cache-Control"))
	require.Equal(t, "/", r.header.Get("Service-Worker-Allowed"))
	r = f.call("GET", "/manifest.json", nil, nil)
	require.Equal(t, 200, r.status)
	require.JSONEq(t, `{"start_url":"/","scope":"/"}`, string(r.body))
	r = f.call("GET", "/", nil, nil)
	require.Equal(t, 200, r.status)
	require.Contains(t, string(r.body), "login")
	require.NotContains(t, string(r.body), "compiled fixture") // Client followed the continuing SSR login redirect.
	require.Error(t, CheckAppAssets(fstest.MapFS{}))
}
func TestWebResponseSchemasAreClosed(t *testing.T) {
	spec, err := GetSwagger()
	require.NoError(t, err)
	require.NoError(t, spec.Validate(context.Background()))
	f := newWebFixture(t)
	f.readingSetup()
	for path, name := range map[string]string{"/api/v1/session": "Session", "/api/v1/capabilities": "Capabilities", "/api/v1/documents": "DocumentPage", "/api/v1/documents/book-a": "Document", "/api/v1/me/reading-state/book-a": "ReadingState"} {
		r := f.call("GET", path, nil, nil)
		require.Equal(t, 200, r.status)
		var value any
		require.NoError(t, json.Unmarshal(r.body, &value))
		schema := spec.Components.Schemas[name].Value
		require.NoError(t, schema.VisitJSON(value))
		object := value.(map[string]any)
		object["private_internal"] = true
		require.Error(t, schema.VisitJSON(object))
	}
	require.Error(t, spec.Components.Schemas["DocumentPage"].Value.VisitJSON(map[string]any{"items": nil, "total": 0, "page": 1, "page_size": 24, "next_page": nil}))
}
