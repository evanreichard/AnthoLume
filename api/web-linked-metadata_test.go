package api

import (
	"context"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/metadata"
)

type linkedCatalogFixture struct {
	identifyCatalogFixture
	resolves      atomic.Int32
	covers        atomic.Int32
	lookups       atomic.Int32
	beforeResolve func(context.Context) error
}

func (f *linkedCatalogFixture) Lookup(ctx context.Context, q string) ([]metadata.LookupMatch, error) {
	f.lookups.Add(1)
	return f.identifyCatalogFixture.Lookup(ctx, q)
}

func (f *linkedCatalogFixture) Resolve(ctx context.Context, work, edition, isbn string) (metadata.LookupMatch, error) {
	f.resolves.Add(1)
	if f.beforeResolve != nil {
		if err := f.beforeResolve(ctx); err != nil {
			return metadata.LookupMatch{}, err
		}
	}
	return f.identifyCatalogFixture.Resolve(ctx, work, edition, isbn)
}

func (f *linkedCatalogFixture) Cover(ctx context.Context, id int64) ([]byte, error) {
	f.covers.Add(1)
	return f.identifyCatalogFixture.Cover(ctx, id)
}

func TestConfirmedSourceReview(t *testing.T) {
	f := newWebFixture(t)
	catalog := &linkedCatalogFixture{}
	f.api.hardcoverCatalog = catalog
	const document = "/api/v1/documents/book"
	const preview = document + "/matches/hardcover?work_id=42"
	const cover = "/api/v1/metadata/covers/123?provider=hardcover&document_id=book&work_id=42"
	const edit = `{"title":"Reviewed title","linked_source":{"provider":"hardcover","work_id":"42"}}`
	assertProblem(t, f.call("GET", preview, nil, nil), 401, "unauthenticated")
	assertProblem(t, f.call("GET", cover, nil, nil), 401, "unauthenticated")
	assertProblem(t, f.call("PATCH", document, edit, nil), 401, "unauthenticated")
	f.register("member")
	f.exec(`UPDATE users SET admin=0 WHERE id='member'`)
	f.exec(`INSERT INTO documents(id,title) VALUES('book','Original')`)
	f.exec(`INSERT INTO document_identifiers VALUES('book','hardcover_book','42'), ('book','openlibrary_work','OL20W')`)
	provider := decodeWeb[AdminMetadataProvider](t, f.call("GET", "/api/v1/metadata/providers", nil, nil))
	require.Equal(t, Openlibrary, provider.Effective)

	assertProblem(t, f.call("GET", "/api/v1/metadata/match?provider=hardcover&work_id=42", nil, nil), 409, "metadata_provider_changed")
	assertProblem(t, f.call("GET", "/api/v1/metadata/covers/123?provider=hardcover", nil, nil), 409, "metadata_provider_changed")
	assertProblem(t, f.call("PATCH", document, `{"title":"Do not save","match":{"provider":"hardcover","work_id":"42"}}`, nil), 409, "metadata_provider_changed")
	assertProblem(t, f.call("PATCH", document, edit, map[string]string{"X-CSRF-Token": "wrong"}), 403, "csrf_failed")
	assertProblem(t, f.call("PATCH", document, `{"title":"Do not save","linked_source":{"provider":"hardcover","work_id":"42"},"match":{"provider":"hardcover","work_id":"42"}}`, nil), 400, "invalid_request")
	assertProblem(t, f.call("GET", document+"/matches/hardcover", nil, nil), 400, "invalid_request")
	for _, query := range []string{"provider=hardcover&document_id=book", "provider=hardcover&work_id=42", "document_id=book&work_id=42", "provider=hardcover&document_id=book&work_id=" + strings.Repeat("x", 65), "provider=hardcover&work_id=42&document_id=" + strings.Repeat("x", 129)} {
		assertProblem(t, f.call("GET", "/api/v1/metadata/covers/123?"+query, nil, nil), 400, "invalid_request")
	}
	assertProblem(t, f.call("GET", strings.Replace(preview, "42", "43", 1), nil, nil), 409, "book_match_changed")
	assertProblem(t, f.call("GET", strings.Replace(cover, "42", "43", 1), nil, nil), 409, "book_match_changed")
	assertProblem(t, f.call("PATCH", document, strings.Replace(edit, "42", "43", 1), nil), 409, "book_match_changed")
	require.Equal(t, int32(0), catalog.resolves.Load())
	require.Equal(t, int32(0), catalog.covers.Load())
	before := decodeWeb[Document](t, f.call("GET", document, nil, nil))
	require.Equal(t, "Original", *before.Title)

	match := decodeWeb[MetadataMatch](t, f.call("GET", preview, nil, nil))
	require.Equal(t, "42", match.Id)
	require.Equal(t, Hardcover, match.Provider)
	require.Equal(t, "Verified Title", match.Title)
	require.Equal(t, int32(1), catalog.resolves.Load())
	require.Equal(t, int32(0), catalog.lookups.Load())
	art := f.call("GET", cover, nil, nil)
	require.Equal(t, http.StatusOK, art.status)
	require.Equal(t, "fixture cover", string(art.body))
	require.Equal(t, int32(1), catalog.covers.Load())
	patch := f.call("PATCH", document, edit, nil)
	require.Equal(t, http.StatusOK, patch.status, string(patch.body))
	saved := decodeWeb[Document](t, patch)
	require.Equal(t, "Reviewed title", *saved.Title)
	require.Equal(t, before.Matches, saved.Matches)
	require.Equal(t, int32(1), catalog.resolves.Load(), "applying a confirmed source must not re-resolve the catalog")

	require.Equal(t, http.StatusNoContent, f.call("DELETE", preview, nil, nil).status)
	assertProblem(t, f.call("GET", preview, nil, nil), 409, "book_match_changed")
	assertProblem(t, f.call("GET", cover, nil, nil), 409, "book_match_changed")
	assertProblem(t, f.call("PATCH", document, strings.Replace(edit, "Reviewed title", "Stale title", 1), nil), 409, "book_match_changed")
	actual := decodeWeb[Document](t, f.call("GET", document, nil, nil))
	require.Equal(t, saved.Title, actual.Title)
	require.Equal(t, []DocumentMatch{{Provider: Openlibrary, WorkId: "OL20W"}}, *actual.Matches)

	require.Equal(t, http.StatusNoContent, f.call("DELETE", document, nil, nil).status)
	assertProblem(t, f.call("GET", preview, nil, nil), 404, "not_found")
	assertProblem(t, f.call("GET", cover, nil, nil), 404, "not_found")
	assertProblem(t, f.call("PATCH", document, edit, nil), 404, "not_found")
	require.Equal(t, int32(1), catalog.resolves.Load())
	require.Equal(t, int32(1), catalog.covers.Load())
}

func TestConfirmedSourceReadChecksLinkAfterProviderIO(t *testing.T) {
	f := newWebFixture(t)
	entered, release := make(chan struct{}), make(chan struct{})
	t.Cleanup(func() { close(release) })
	f.api.hardcoverCatalog = &linkedCatalogFixture{beforeResolve: func(ctx context.Context) error {
		close(entered)
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}}
	f.register("member")
	f.exec(`INSERT INTO documents(id,title) VALUES('book','Original')`)
	f.exec(`INSERT INTO document_identifiers VALUES('book','hardcover_book','42')`)
	const path = "/api/v1/documents/book/matches/hardcover?work_id=42"
	result := make(chan webResponse, 1)
	go func() { result <- f.call("GET", path, nil, nil) }()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("provider was not called")
	}
	require.Equal(t, http.StatusNoContent, f.call("DELETE", path, nil, nil).status)
	release <- struct{}{}
	select {
	case r := <-result:
		assertProblem(t, r, 409, "book_match_changed")
	case <-time.After(3 * time.Second):
		t.Fatal("preview did not finish")
	}
}
