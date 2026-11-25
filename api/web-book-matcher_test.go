package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/metadata"
)

const bookMatcherLookupPath = "/api/v1/metadata/lookups"
const matcherDocumentsPath = "/api/v1/documents?page_size=10&sort=title"
const metadataProvidersPath = "/api/v1/metadata/providers"

func matcherLinkCatalog() matcherEngineCatalog {
	return matcherEngineCatalog{resolve: func(_ context.Context, work, _, _ string) (metadata.LookupMatch, error) {
		if work != "OL100W" && work != "OL200W" {
			return metadata.LookupMatch{}, metadata.ErrInvalidLookupMatch
		}
		return metadata.LookupMatch{ID: work}, nil
	}}
}

func TestBookMatcherSessionAndRequestBoundaries(t *testing.T) {
	f := newWebFixture(t)
	match := "/api/v1/documents/book-01/matches/openlibrary"
	lookup := `{"provider":"openlibrary","document_ids":["book-01"]}`
	assertProblem(t, f.call("GET", matcherDocumentsPath+"&include=matches", nil, nil), 401, "unauthenticated")
	assertProblem(t, f.call("GET", metadataProvidersPath, nil, nil), 401, "unauthenticated")
	assertProblem(t, f.call("POST", bookMatcherLookupPath, lookup, nil), 401, "unauthenticated")
	assertProblem(t, f.call("PUT", match, `{"work_id":"OL100W"}`, nil), 401, "unauthenticated")
	assertProblem(t, f.call("DELETE", match+"?work_id=OL100W", nil, nil), 401, "unauthenticated")
	registerMatcherReader(t, f)
	assertProblem(t, f.call("POST", bookMatcherLookupPath, lookup, map[string]string{"X-CSRF-Token": "wrong"}), 403, "csrf_failed")
	assertProblem(t, f.call("PUT", match, `{"work_id":"OL100W"}`, map[string]string{"Origin": "https://example.test"}), 403, "csrf_failed")
	assertProblem(t, f.call("DELETE", match+"?work_id=OL100W", nil, map[string]string{"X-CSRF-Token": "wrong"}), 403, "csrf_failed")
	assertProblem(t, f.call("GET", matcherDocumentsPath+"&include=other", nil, nil), 400, "invalid_request")
	assertProblem(t, f.call("POST", bookMatcherLookupPath, `{"provider":"openlibrary","document_ids":[]}`, nil), 400, "invalid_request")
	assertProblem(t, f.call("POST", bookMatcherLookupPath, `{"provider":"openlibrary","document_ids":["a","a"]}`, nil), 400, "invalid_request")
	assertProblem(t, f.call("POST", bookMatcherLookupPath, `{"provider":"openlibrary","document_ids":["1","2","3","4","5","6","7","8","9","10","11"]}`, nil), 400, "invalid_request")
	assertProblem(t, f.call("DELETE", match, nil, nil), 400, "invalid_request")
	require.Equal(t, 200, f.call("GET", metadataProvidersPath, nil, nil).status)
}

func registerMatcherReader(t *testing.T, f *webFixture) {
	t.Helper()
	f.register("reader")
	f.exec("UPDATE users SET admin=0 WHERE id='reader'")
}

func TestListDocumentsIncludesConfirmedMatchesAfterPagination(t *testing.T) {
	f := newWebFixture(t)
	registerMatcherReader(t, f)
	for i := 11; i >= 1; i-- {
		f.exec(fmt.Sprintf(`INSERT INTO documents(id,title,author) VALUES ('book-%02d','Same Title','Author')`, i))
	}
	f.exec(`INSERT INTO documents(id,title,deleted) VALUES ('deleted','AA',1)`)
	f.exec(`INSERT INTO document_identifiers VALUES ('book-01','openlibrary_work','OL100W'), ('book-01','hardcover_book','42'), ('book-02','openlibrary','OL200W'), ('book-02','openlibrary_edition','OL1M'), ('book-11','openlibrary_work','OL200W')`)
	read := func(path string) DocumentPage {
		r := f.call("GET", path, nil, nil)
		require.Equal(t, 200, r.status, string(r.body))
		return decodeWeb[DocumentPage](t, r)
	}
	ordinary := f.call("GET", matcherDocumentsPath, nil, nil)
	require.Equal(t, 200, ordinary.status, string(ordinary.body))
	ordinaryPage := decodeWeb[struct{ Items []map[string]json.RawMessage }](t, ordinary)
	require.Len(t, ordinaryPage.Items, 10)
	for _, item := range ordinaryPage.Items {
		require.NotContains(t, item, "matches")
	}
	first := read(matcherDocumentsPath + "&include=matches")
	require.Equal(t, 1, first.Page)
	require.Equal(t, 11, first.Total)
	require.Len(t, first.Items, 10)
	require.Equal(t, "book-01", first.Items[0].Id)
	require.Equal(t, "book-10", first.Items[9].Id)
	require.NotNil(t, first.Items[0].Matches)
	require.ElementsMatch(t, []DocumentMatch{{Provider: Openlibrary, WorkId: "OL100W"}, {Provider: Hardcover, WorkId: "42"}}, *first.Items[0].Matches)
	for _, item := range first.Items[1:] {
		require.NotNil(t, item.Matches)
		require.Equal(t, []DocumentMatch{}, *item.Matches)
	}
	second := read(matcherDocumentsPath + "&include=matches&page=2")
	require.Equal(t, 2, second.Page)
	require.Equal(t, 11, second.Total)
	require.Len(t, second.Items, 1)
	require.Equal(t, "book-11", second.Items[0].Id)
	require.NotNil(t, second.Items[0].Matches)
	require.Equal(t, []DocumentMatch{{Provider: Openlibrary, WorkId: "OL200W"}}, *second.Items[0].Matches)
	require.Equal(t, []Document{}, read(matcherDocumentsPath+"&include=matches&page=2147483647").Items)
}

func TestBookMatcherStreamsWithoutHoldingSQLite(t *testing.T) {
	f := newWebFixture(t)
	lookupStarted, release := make(chan struct{}), make(chan struct{})
	f.api.openLibraryCatalog = matcherEngineCatalog{lookup: func(ctx context.Context, books []metadata.MatcherInput, emit func(string, []metadata.LookupMatch, error) error) error {
		for _, book := range books {
			if book.Title == "Fast Title" {
				if err := emit(book.ID, []metadata.LookupMatch{{ID: "OL200W", Title: book.Title, Author: book.Author}}, nil); err != nil {
					return err
				}
				continue
			}
			close(lookupStarted)
			select {
			case <-release:
				return emit(book.ID, nil, nil)
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}}
	registerMatcherReader(t, f)
	f.exec(`INSERT INTO documents(id,title,author) VALUES ('linked','First Title','First Author'), ('pending','Second Title','Second Author'), ('fast','Fast Title','Fast Author')`)
	f.exec(`INSERT INTO document_identifiers VALUES ('linked','openlibrary_work','OL100W')`)

	request := f.newRequest("POST", bookMatcherLookupPath,
		`{"provider":"openlibrary","document_ids":["fast","pending","linked","missing"]}`, nil)
	response, err := f.client.Do(request)
	require.NoError(t, err)
	defer response.Body.Close()
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.Equal(t, "application/x-ndjson", response.Header.Get("Content-Type"))
	require.Equal(t, "private, no-store", response.Header.Get("Cache-Control"))
	reader := bufio.NewReader(response.Body)
	assertLine := func(want string) {
		t.Helper()
		line, err := reader.ReadString('\n')
		require.NoError(t, err)
		require.JSONEq(t, want, line)
	}
	assertLine(`{"document_id":"linked","match":{"work_id":"OL100W","url":"https://openlibrary.org/works/OL100W"}}`)
	assertLine(`{"document_id":"missing","error":"not_found"}`)
	assertLine(`{"document_id":"fast","candidates":[{"work_id":"OL200W","title":"Fast Title","author":"Fast Author","url":"https://openlibrary.org/works/OL200W"}]}`)
	select {
	case <-lookupStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("catalog lookup did not start")
	}
	require.Equal(t, 200, f.call("GET", matcherDocumentsPath+"&include=matches", nil, nil).status)
	close(release)
	assertLine(`{"document_id":"pending","candidates":[]}`)
	_, err = reader.ReadByte()
	require.ErrorIs(t, err, io.EOF)
	require.Equal(t, 1, f.count("document_identifiers"))
}

func TestBookMatcherConcurrentConfirms(t *testing.T) {
	f := newWebFixture(t)
	// Make both requests reach provider resolution before either can write the link.
	var resolving atomic.Int32
	bothResolving := make(chan struct{})
	catalog := matcherLinkCatalog()
	resolve := catalog.resolve
	catalog.resolve = func(ctx context.Context, work, edition, isbn string) (metadata.LookupMatch, error) {
		if resolving.Add(1) == 2 {
			close(bothResolving)
		}
		select {
		case <-bothResolving:
			return resolve(ctx, work, edition, isbn)
		case <-ctx.Done():
			return metadata.LookupMatch{}, ctx.Err()
		}
	}
	f.api.openLibraryCatalog = catalog
	registerMatcherReader(t, f)
	f.exec(`INSERT INTO documents(id,title) VALUES ('book','Local Title')`)

	type result struct {
		workID string
		status int
		err    error
	}
	results := make(chan result, 2)
	for _, workID := range []string{"OL100W", "OL200W"} {
		r := f.newRequest("PUT", "/api/v1/documents/book/matches/openlibrary", BookMatcherWork{WorkId: workID}, nil)
		go func() {
			response, err := f.client.Do(r)
			if err != nil {
				results <- result{workID: workID, err: err}
				return
			}
			response.Body.Close()
			results <- result{workID: workID, status: response.StatusCode}
		}()
	}
	first, second := <-results, <-results
	require.EqualValues(t, 2, resolving.Load())
	require.NoError(t, first.err)
	require.NoError(t, second.err)
	require.ElementsMatch(t, []int{http.StatusNoContent, http.StatusConflict}, []int{first.status, second.status})
	winner := first
	if second.status == http.StatusNoContent {
		winner = second
	}
	r := f.call("GET", matcherDocumentsPath+"&include=matches", nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	page := decodeWeb[DocumentPage](t, r)
	require.Len(t, page.Items, 1)
	require.NotNil(t, page.Items[0].Matches)
	require.Equal(t, []DocumentMatch{{Provider: Openlibrary, WorkId: winner.workID}}, *page.Items[0].Matches)
	require.Equal(t, 1, f.count("document_identifiers"))
}

func TestBookMatcherLinkMutations(t *testing.T) {
	f := newWebFixture(t)
	f.api.openLibraryCatalog = matcherLinkCatalog()
	f.api.hardcoverCatalog = identifyCatalogFixture{}
	registerMatcherReader(t, f)
	f.exec(`INSERT INTO settings(name,value) VALUES ('metadata_provider','hardcover') ON CONFLICT(name) DO UPDATE SET value=excluded.value`)
	f.exec(`INSERT INTO documents(id,title,author,isbn13,description,coverfile) VALUES ('book','Local Title','Local Author','9780765391193','Local Description','local.png')`)
	f.exec(`INSERT INTO document_identifiers VALUES ('book','hardcover_book','42'), ('book','openlibrary_edition','OL5M')`)
	path := "/api/v1/documents/book/matches/openlibrary"
	assertProblem(t, f.call("PUT", path, `{"work_id":"OL900W"}`, nil), 400, "invalid_request")
	require.Equal(t, 2, f.count("document_identifiers"))
	for range 2 {
		r := f.call("PUT", path, `{"work_id":"OL100W"}`, nil)
		require.Equal(t, 204, r.status, string(r.body))
	}
	assertProblem(t, f.call("PUT", path, `{"work_id":"OL200W"}`, nil), 409, "book_match_changed")
	assertProblem(t, f.call("DELETE", path+"?work_id=OL200W", nil, nil), 409, "book_match_changed")
	require.Equal(t, 3, f.count("document_identifiers"))
	for range 2 {
		r := f.call("DELETE", path+"?work_id=OL100W", nil, nil)
		require.Equal(t, 204, r.status, string(r.body))
	}
	require.Equal(t, 2, f.count("document_identifiers"))
	r := f.call("PUT", path, `{"work_id":"OL100W"}`, nil)
	require.Equal(t, 204, r.status, string(r.body))
	assertProblem(t, f.call("DELETE", "/api/v1/documents/missing/matches/openlibrary?work_id=OL100W", nil, nil), 404, "not_found")
	document, err := f.db.Queries.GetDocument(context.Background(), "book")
	require.NoError(t, err)
	require.Equal(t, "Local Title", *document.Title)
	require.Equal(t, "Local Author", *document.Author)
	require.Equal(t, "9780765391193", *document.Isbn13)
	require.Equal(t, "Local Description", *document.Description)
	require.Equal(t, "local.png", *document.Coverfile)
	stateResponse := f.call("GET", metadataProvidersPath, nil, nil)
	require.Equal(t, 200, stateResponse.status, string(stateResponse.body))
	require.Equal(t, AdminMetadataProvider{Selected: Hardcover, Effective: Hardcover, HardcoverAvailable: true}, decodeWeb[AdminMetadataProvider](t, stateResponse))
}
