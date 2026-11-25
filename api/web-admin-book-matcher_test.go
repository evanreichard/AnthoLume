package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/metadata"
)

const bookMatcherPagePath = "/api/v1/admin/book-matcher"
const bookMatcherLookupPath = bookMatcherPagePath + "/lookups"

type matcherHTTPCatalog struct {
	lookup func(context.Context, string) ([]metadata.LookupMatch, error)
}

func (c matcherHTTPCatalog) Lookup(ctx context.Context, query string) ([]metadata.LookupMatch, error) {
	if c.lookup == nil {
		return nil, nil
	}
	return c.lookup(ctx, query)
}

func (c matcherHTTPCatalog) LookupMatcherBatch(ctx context.Context, books []metadata.MatcherInput, emit func(string, []metadata.LookupMatch, error) error) error {
	for _, book := range books {
		matches, err := c.Lookup(ctx, book.SearchText())
		if err := emit(book.ID, matches, err); err != nil {
			return err
		}
	}
	return nil
}

func (c matcherHTTPCatalog) ResolveMatcher(ctx context.Context, work, edition, isbn string) (metadata.LookupMatch, error) {
	return c.Resolve(ctx, work, edition, isbn)
}

func (matcherHTTPCatalog) Resolve(_ context.Context, work, _, _ string) (metadata.LookupMatch, error) {
	if work != "OL100W" && work != "OL200W" {
		return metadata.LookupMatch{}, metadata.ErrInvalidLookupMatch
	}
	return metadata.LookupMatch{ID: work}, nil
}

func TestAdminBookMatcherPageAndBoundaries(t *testing.T) {
	f := newWebFixture(t)
	f.api.openLibraryCatalog = matcherHTTPCatalog{}
	page := bookMatcherPagePath + "?provider=openlibrary"
	match := "/api/v1/admin/documents/book-01/matches/openlibrary"
	lookup := `{"provider":"openlibrary","document_ids":["book-01"]}`
	assertProblem(t, f.call("GET", page, nil, nil), 401, "unauthenticated")
	assertProblem(t, f.call("POST", bookMatcherLookupPath, lookup, nil), 401, "unauthenticated")
	f.register("admin")
	f.exec("UPDATE users SET admin=0 WHERE id='admin'")
	assertProblem(t, f.call("GET", page, nil, nil), 403, "forbidden")
	assertProblem(t, f.call("POST", bookMatcherLookupPath, lookup, nil), 403, "forbidden")
	assertProblem(t, f.call("PUT", match, `{"work_id":"OL100W"}`, nil), 403, "forbidden")
	assertProblem(t, f.call("DELETE", match+"?work_id=OL100W", nil, nil), 403, "forbidden")
	f.exec("UPDATE users SET admin=1 WHERE id='admin'")
	assertProblem(t, f.call("POST", bookMatcherLookupPath, lookup, map[string]string{"X-CSRF-Token": "wrong"}), 403, "csrf_failed")
	assertProblem(t, f.call("PUT", match, `{"work_id":"OL100W"}`, map[string]string{"Origin": "https://example.test"}), 403, "csrf_failed")
	assertProblem(t, f.call("DELETE", match+"?work_id=OL100W", nil, map[string]string{"X-CSRF-Token": "wrong"}), 403, "csrf_failed")
	assertProblem(t, f.call("GET", bookMatcherPagePath, nil, nil), 400, "invalid_request")
	assertProblem(t, f.call("GET", page+"&page=0", nil, nil), 400, "invalid_request")
	assertProblem(t, f.call("POST", bookMatcherLookupPath, `{"provider":"openlibrary","document_ids":["a","a"]}`, nil), 400, "invalid_request")
	assertProblem(t, f.call("POST", bookMatcherLookupPath, `{"provider":"openlibrary","document_ids":["1","2","3","4","5","6","7","8","9","10","11"]}`, nil), 400, "invalid_request")
	assertProblem(t, f.call("DELETE", match, nil, nil), 400, "invalid_request")

	for i := 11; i >= 1; i-- {
		f.exec(fmt.Sprintf(`INSERT INTO documents(id,title,author) VALUES ('book-%02d','Same Title','Author')`, i))
	}
	f.exec(`INSERT INTO documents(id,title,deleted) VALUES ('deleted','AA',1)`)
	f.exec(`UPDATE documents SET isbn10='0123456789', isbn13='9780765391193' WHERE id='book-01'`)
	f.exec(`UPDATE documents SET isbn10='0123456789' WHERE id='book-02'`)
	f.exec(`INSERT INTO document_identifiers VALUES ('book-01','openlibrary_work','OL100W'), ('book-01','hardcover_book','42'), ('book-02','openlibrary','OL200W')`)
	read := func(path string) AdminBookMatcherPage {
		r := f.call("GET", path, nil, nil)
		require.Equal(t, 200, r.status, string(r.body))
		var jsonPage AdminBookMatcherPage
		require.NoError(t, json.Unmarshal(r.body, &jsonPage))
		return jsonPage
	}
	first := read(page)
	require.Equal(t, 1, first.Page)
	require.Equal(t, 11, first.Total)
	require.Len(t, first.Items, 10)
	require.Equal(t, "book-01", first.Items[0].Id)
	require.Equal(t, "Same Title", first.Items[0].Title)
	require.Equal(t, "Author", first.Items[0].Author)
	require.Equal(t, "9780765391193", *first.Items[0].Isbn)
	require.Equal(t, "OL100W", first.Items[0].Match.WorkId)
	require.Contains(t, first.Items[0].Match.Url, "openlibrary.org/works/OL100W")
	require.Equal(t, "0123456789", *first.Items[1].Isbn)
	require.Nil(t, first.Items[1].Match)
	require.Nil(t, first.Items[2].Isbn)
	require.Equal(t, "book-10", first.Items[9].Id)
	second := read(page + "&page=2")
	require.Equal(t, 2, second.Page)
	require.Equal(t, 11, second.Total)
	require.Len(t, second.Items, 1)
	require.Equal(t, "book-11", second.Items[0].Id)
	require.Equal(t, []AdminBookMatcherItem{}, read(page+"&page=2147483647").Items)
	require.Equal(t, "42", read(bookMatcherPagePath + "?provider=hardcover").Items[0].Match.WorkId)
}

func TestAdminBookMatcherStreamsWithoutHoldingSQLite(t *testing.T) {
	f := newWebFixture(t)
	lookupStarted := make(chan struct{}, 1)
	release := make(chan struct{})
	f.api.openLibraryCatalog = matcherHTTPCatalog{lookup: func(ctx context.Context, query string) ([]metadata.LookupMatch, error) {
		if strings.Contains(query, "Fast") {
			return []metadata.LookupMatch{{ID: "OL200W", Title: "Fast Title", Author: "Fast Author"}}, nil
		}
		select {
		case lookupStarted <- struct{}{}:
		default:
		}
		select {
		case <-release:
			return nil, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}}
	f.register("admin")
	f.exec(`UPDATE users SET admin=1 WHERE id='admin'`)
	f.exec(`INSERT INTO documents(id,title,author) VALUES ('linked','First Title','First Author'), ('pending','Second Title','Second Author'), ('fast','Fast Title','Fast Author')`)
	f.exec(`INSERT INTO document_identifiers VALUES ('linked','openlibrary_work','OL100W')`)

	request, err := http.NewRequest("POST", f.server.URL+bookMatcherLookupPath,
		strings.NewReader(`{"provider":"openlibrary","document_ids":["fast","pending","linked","missing"]}`))
	require.NoError(t, err)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-CSRF-Token", f.csrf)
	request.Header.Set("Origin", f.cfg.PublicOrigin)
	response, err := f.client.Do(request)
	require.NoError(t, err)
	defer response.Body.Close()
	require.Equal(t, http.StatusOK, response.StatusCode)
	require.Equal(t, "application/x-ndjson", response.Header.Get("Content-Type"))
	require.Equal(t, "private, no-store", response.Header.Get("Cache-Control"))
	reader := bufio.NewReader(response.Body)
	line, err := reader.ReadString('\n')
	require.NoError(t, err)
	var linked AdminBookMatcherOutcome
	require.NoError(t, json.Unmarshal([]byte(line), &linked))
	require.Equal(t, "linked", linked.DocumentId)
	require.NotNil(t, linked.Match)
	require.Equal(t, "OL100W", linked.Match.WorkId)
	line, err = reader.ReadString('\n')
	require.NoError(t, err)
	require.JSONEq(t, `{"document_id":"missing","error":"not_found"}`, line)
	line, err = reader.ReadString('\n')
	require.NoError(t, err)
	var fast AdminBookMatcherOutcome
	require.NoError(t, json.Unmarshal([]byte(line), &fast))
	require.Equal(t, "fast", fast.DocumentId)
	require.NotNil(t, fast.Candidates)
	require.Len(t, *fast.Candidates, 1)
	require.Equal(t, "OL200W", (*fast.Candidates)[0].WorkId)
	require.Equal(t, "Fast Title", (*fast.Candidates)[0].Title)
	require.Equal(t, "Fast Author", (*fast.Candidates)[0].Author)
	require.Contains(t, (*fast.Candidates)[0].Url, "openlibrary.org/works/OL200W")
	select {
	case <-lookupStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("catalog lookup did not start")
	}
	require.Equal(t, 200, f.call("GET", bookMatcherPagePath+"?provider=openlibrary", nil, nil).status)
	close(release)
	line, err = reader.ReadString('\n')
	require.NoError(t, err)
	require.JSONEq(t, `{"document_id":"pending","candidates":[]}`, line)
	_, err = reader.ReadByte()
	require.ErrorIs(t, err, io.EOF)
	require.Equal(t, 1, f.count("document_identifiers"))
}

func TestAdminBookMatcherConcurrentConfirms(t *testing.T) {
	f := newWebFixture(t)
	f.api.openLibraryCatalog = matcherHTTPCatalog{}
	f.register("admin")
	f.exec(`UPDATE users SET admin=1 WHERE id='admin'`)
	f.exec(`INSERT INTO documents(id,title) VALUES ('book','Local Title')`)

	start := make(chan struct{})
	type result struct {
		workID string
		status int
		err    error
	}
	results := make(chan result, 2)
	for _, workID := range []string{"OL100W", "OL200W"} {
		r, err := http.NewRequest("PUT", f.server.URL+"/api/v1/admin/documents/book/matches/openlibrary",
			strings.NewReader(fmt.Sprintf(`{"work_id":%q}`, workID)))
		require.NoError(t, err)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-CSRF-Token", f.csrf)
		r.Header.Set("Origin", f.cfg.PublicOrigin)
		go func() {
			<-start
			response, err := f.client.Do(r)
			if err != nil {
				results <- result{workID: workID, err: err}
				return
			}
			response.Body.Close()
			results <- result{workID: workID, status: response.StatusCode}
		}()
	}
	close(start)
	first, second := <-results, <-results
	require.NoError(t, first.err)
	require.NoError(t, second.err)
	require.ElementsMatch(t, []int{http.StatusNoContent, http.StatusConflict}, []int{first.status, second.status})
	winner := first
	if second.status == http.StatusNoContent {
		winner = second
	}
	r := f.call("GET", bookMatcherPagePath+"?provider=openlibrary", nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	var page AdminBookMatcherPage
	require.NoError(t, json.Unmarshal(r.body, &page))
	require.Len(t, page.Items, 1)
	require.NotNil(t, page.Items[0].Match)
	require.Equal(t, winner.workID, page.Items[0].Match.WorkId)
	require.Equal(t, 1, f.count("document_identifiers"))
}

func TestAdminBookMatcherLinkMutations(t *testing.T) {
	f := newWebFixture(t)
	f.api.openLibraryCatalog = matcherHTTPCatalog{}
	f.api.hardcoverCatalog = identifyCatalogFixture{}
	f.register("admin")
	f.exec(`UPDATE users SET admin=1 WHERE id='admin'`)
	f.exec(`INSERT INTO settings(name,value) VALUES ('metadata_provider','hardcover') ON CONFLICT(name) DO UPDATE SET value=excluded.value`)
	f.exec(`INSERT INTO documents(id,title,author,isbn13,description,coverfile) VALUES ('book','Local Title','Local Author','9780765391193','Local Description','local.png')`)
	f.exec(`INSERT INTO document_identifiers VALUES ('book','hardcover_book','42'), ('book','openlibrary_edition','OL5M')`)
	path := "/api/v1/admin/documents/book/matches/openlibrary"
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
	assertProblem(t, f.call("DELETE", "/api/v1/admin/documents/missing/matches/openlibrary?work_id=OL100W", nil, nil), 404, "not_found")
	document, err := f.db.Queries.GetDocument(context.Background(), "book")
	require.NoError(t, err)
	require.Equal(t, "Local Title", *document.Title)
	require.Equal(t, "Local Author", *document.Author)
	require.Equal(t, "9780765391193", *document.Isbn13)
	require.Equal(t, "Local Description", *document.Description)
	require.Equal(t, "local.png", *document.Coverfile)
	stateResponse := f.call("GET", adminMetadataPath, nil, nil)
	require.Equal(t, 200, stateResponse.status, string(stateResponse.body))
	var state AdminMetadataProvider
	require.NoError(t, json.Unmarshal(stateResponse.body, &state))
	require.Equal(t, Hardcover, state.Selected)
	require.Equal(t, Hardcover, state.Effective)
}
