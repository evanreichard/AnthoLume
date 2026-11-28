package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/database"
	"reichard.io/antholume/shelfmark"
)

const shelfmarkRequestsPath = "/api/v1/shelfmark/requests"
const shelfmarkReleasesPath = "/api/v1/shelfmark/releases"
const shelfmarkTestBook = `{"provider":"hardcover","provider_id":"69589","title":"The Time Machine","authors":["H. G. Wells"],"publish_year":1895}`
const shelfmarkTestAlias = `{"provider":"openlibrary","provider_id":"OL1W","title":"The Time Machine"}`
const shelfmarkTestReleases = `[{"source":"prowlarr","source_id":"secret-source-one","title":"Release A","author":"Release A Author","format":"epub","download_url":"https://example.org/sensitive"},{"source":"newznab","source_id":"secret-source-one","title":"Release B","format":"pdf"}]`

func testShelfmark(t *testing.T, f *webFixture, handle http.HandlerFunc) {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "test-shelfmark-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		handle(w, r)
	}))
	t.Cleanup(upstream.Close)
	var err error
	f.api.shelfmark, err = shelfmark.New(upstream.URL, "test-shelfmark-key")
	require.NoError(t, err)
}

func shelfmarkDownloadBody(release ShelfmarkRelease) map[string]string {
	return map[string]string{"provider": "hardcover", "id": "69589", "release_key": release.Key, "selection": *release.Selection}
}

func TestShelfmarkConfigurationAndGate(t *testing.T) {
	f := newWebFixture(t)
	settings := "/api/v1/shelfmark/settings"
	admin := "/api/v1/admin/shelfmark"
	assertProblem(t, f.call("GET", settings, nil, nil), 401, "unauthenticated")
	f.register("shelfmark-admin")
	r := f.call("GET", settings, nil, nil)
	require.Equal(t, 200, r.status)
	require.Equal(t, ShelfmarkSettings{}, decodeWeb[ShelfmarkSettings](t, r))
	f.exec("UPDATE users SET admin=1 WHERE id='shelfmark-admin'")
	assertProblem(t, f.call("PUT", admin, map[string]bool{"enabled": true}, nil), 409, "shelfmark_unconfigured")
	testShelfmark(t, f, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/metadata/search" || r.URL.Query().Get("query") != "Time Machine" {
			w.WriteHeader(404)
			return
		}
		fmt.Fprint(w, `{"books":[]}`)
	})
	r = f.call("GET", settings, nil, nil)
	require.Equal(t, ShelfmarkSettings{Configured: true, Enabled: true}, decodeWeb[ShelfmarkSettings](t, r))
	search := "/api/v1/shelfmark/search?q=Time+Machine"
	r = f.call("GET", search, nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.JSONEq(t, `[]`, string(r.body))
	r = f.call("PUT", admin, map[string]bool{"enabled": false}, nil)
	require.Equal(t, ShelfmarkSettings{Configured: true}, decodeWeb[ShelfmarkSettings](t, r))
	r = f.call("GET", settings, nil, nil)
	require.Equal(t, ShelfmarkSettings{Configured: true}, decodeWeb[ShelfmarkSettings](t, r))
	for _, endpoint := range []string{search, "/api/v1/shelfmark/cover?provider=hardcover&id=69589", shelfmarkRequestsPath,
		shelfmarkReleasesPath + "?provider=hardcover&id=69589", shelfmarkRequestsPath + "/releases?provider=hardcover&id=69589"} {
		assertProblem(t, f.call("GET", endpoint, nil, nil), 409, "shelfmark_disabled")
	}
	assertProblem(t, f.call("POST", shelfmarkRequestsPath, shelfmarkDownloadBody(ShelfmarkRelease{Key: "key", Selection: new("selection")}), nil), 409, "shelfmark_disabled")
}

func TestShelfmarkReleaseRecommendation(t *testing.T) {
	f := newWebFixture(t)
	var posts atomic.Int32
	testShelfmark(t, f, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
		}
		if r.Method != http.MethodGet || r.URL.Path != "/api/releases" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		fmt.Fprint(w, `{"book":`+shelfmarkTestBook+`,"releases":[
			{"source":"prowlarr","source_id":"wrong-title","title":"The Time Machine Companion","author":"H. G. Wells","format":"epub","content_type":"ebook"},
			{"source":"prowlarr","source_id":"correct-title","title":"The Time Machine","author":"H. G. Wells","format":"epub","content_type":"ebook"}
		]}`)
	})
	f.register("alex")
	query := "?provider=hardcover&id=69589"
	response := f.call("GET", shelfmarkReleasesPath+query, nil, nil)
	require.Equal(t, 200, response.status, string(response.body))
	list := decodeWeb[ShelfmarkReleaseList](t, response)
	require.Len(t, list.Releases, 2)
	require.Equal(t, "The Time Machine", list.Releases[0].Title)
	require.NotNil(t, list.Releases[0].Selection)
	require.Equal(t, &ShelfmarkRecommendation{
		ReleaseKey: list.Releases[0].Key,
		Basis:      ShelfmarkMatchTitleAuthor,
	}, list.Recommendation)
	history := f.call("GET", shelfmarkRequestsPath+"/releases"+query, nil, nil)
	require.Equal(t, 200, history.status, string(history.body))
	require.JSONEq(t, `[]`, string(history.body))
	require.Zero(t, posts.Load())
}

func TestShelfmarkSharedReleaseClaimAndGroupedHistory(t *testing.T) {
	f := newWebFixture(t)
	entered, finish := make(chan struct{}), make(chan struct{})
	var ready, release sync.Once
	end := func() { release.Do(func() { close(finish) }) }
	var posts atomic.Int32
	testShelfmark(t, f, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "GET /api/metadata/book/hardcover/69589":
			fmt.Fprint(w, shelfmarkTestBook)
		case "GET /api/metadata/search":
			fmt.Fprint(w, `{"books":[`+shelfmarkTestBook+`,`+shelfmarkTestAlias+`]}`)
		case "GET /api/releases":
			q := r.URL.Query()
			if q.Get("content_type") != "ebook" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			book := shelfmarkTestBook
			if q.Get("provider") == "openlibrary" && q.Get("book_id") == "OL1W" {
				book = shelfmarkTestAlias
			}
			fmt.Fprint(w, `{"book":`+book+`,"releases":`+shelfmarkTestReleases+`,"errors":["another source was unavailable"]}`)
		case "POST /api/releases/download":
			posts.Add(1)
			var payload map[string]any
			if json.NewDecoder(r.Body).Decode(&payload) != nil || payload["source_id"] != "secret-source-one" || payload["content_type"] != "ebook" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			switch payload["source"] {
			case "prowlarr":
				ready.Do(func() { close(entered) })
				<-finish
				conn, _, err := w.(http.Hijacker).Hijack()
				if err == nil {
					conn.Close()
				}
			case "newznab":
				fmt.Fprint(w, `{"status":"queued"}`)
			default:
				w.WriteHeader(http.StatusBadRequest)
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	t.Cleanup(end)
	f.register("alex")
	other := *f
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	other.client = &http.Client{Jar: jar, Timeout: 5 * time.Second}
	other.register("sam")
	assertProblem(t, other.call("PUT", "/api/v1/admin/shelfmark", map[string]bool{"enabled": false}, nil), 403, "forbidden")
	listing := f.call("GET", shelfmarkReleasesPath+"?provider=hardcover&id=69589", nil, nil)
	require.Equal(t, 200, listing.status, string(listing.body))
	require.NotContains(t, string(listing.body), "secret-source-one")
	require.NotContains(t, string(listing.body), "example.org")
	files := decodeWeb[ShelfmarkReleaseList](t, listing)
	require.True(t, files.Partial)
	require.Len(t, files.Releases, 2)
	require.Nil(t, files.Releases[0].Request)
	require.Equal(t, new("Release A Author"), files.Releases[0].Author)
	require.Nil(t, files.Releases[1].Author)
	assertProblem(t, f.call("POST", shelfmarkRequestsPath, shelfmarkDownloadBody(ShelfmarkRelease{Key: files.Releases[0].Key, Selection: new("tampered")}), nil), 400, "shelfmark_invalid_selection")
	aliasList := decodeWeb[ShelfmarkReleaseList](t, other.call("GET", shelfmarkReleasesPath+"?provider=openlibrary&id=OL1W", nil, nil))
	alias := shelfmarkDownloadBody(aliasList.Releases[0])
	alias["provider"], alias["id"] = "openlibrary", "OL1W"
	wrongBook := shelfmarkDownloadBody(files.Releases[0])
	wrongBook["id"] = "999"
	assertProblem(t, f.call("POST", shelfmarkRequestsPath, wrongBook, nil), 400, "shelfmark_invalid_selection")
	require.Zero(t, posts.Load())

	payload := shelfmarkDownloadBody(files.Releases[0])
	first := f.newRequest("POST", shelfmarkRequestsPath, payload, nil)
	type outcome struct {
		response webResponse
		err      error
	}
	done := make(chan outcome, 1)
	go func() {
		r, err := f.client.Do(first)
		if err != nil {
			done <- outcome{err: err}
			return
		}
		defer r.Body.Close()
		data, err := io.ReadAll(r.Body)
		done <- outcome{webResponse{r.StatusCode, r.Header, data}, err}
	}()
	select {
	case <-entered:
	case <-time.After(4 * time.Second):
		t.Fatal("upstream request not reached")
	}
	shared := other.call("POST", shelfmarkRequestsPath, payload, nil)
	require.Equal(t, 200, shared.status, string(shared.body))
	claim := decodeWeb[ShelfmarkDownloadResult](t, shared).Release
	require.NotNil(t, claim.Request)
	require.Equal(t, files.Releases[0].Author, claim.Author)
	require.Equal(t, "alex", claim.Request.Username)
	require.Equal(t, ShelfmarkUnconfirmed, claim.Request.State)
	require.EqualValues(t, 1, posts.Load())
	end()
	out := <-done
	require.NoError(t, out.err)
	require.Equal(t, 200, out.response.status, string(out.response.body))
	require.Equal(t, claim, decodeWeb[ShelfmarkDownloadResult](t, out.response).Release)

	aliases := other.call("GET", shelfmarkReleasesPath+"?provider=openlibrary&id=OL1W", nil, nil)
	require.Equal(t, 200, aliases.status, string(aliases.body))
	require.Equal(t, claim.Request, decodeWeb[ShelfmarkReleaseList](t, aliases).Releases[0].Request)
	duplicate := other.call("POST", shelfmarkRequestsPath, alias, nil)
	require.Equal(t, 200, duplicate.status, string(duplicate.body))
	require.Equal(t, claim, decodeWeb[ShelfmarkDownloadResult](t, duplicate).Release)
	require.EqualValues(t, 1, posts.Load())

	second := other.call("POST", shelfmarkRequestsPath, shelfmarkDownloadBody(files.Releases[1]), nil)
	require.Equal(t, 200, second.status, string(second.body))
	result := decodeWeb[ShelfmarkDownloadResult](t, second)
	require.Equal(t, 2, result.RequestCount)
	queued := result.Release
	require.NotNil(t, queued.Request)
	require.Nil(t, queued.Author)
	require.Equal(t, "sam", queued.Request.Username)
	require.Equal(t, ShelfmarkQueued, queued.Request.State)
	require.EqualValues(t, 2, posts.Load())
	matches := decodeWeb[[]ShelfmarkBook](t, other.call("GET", "/api/v1/shelfmark/search?q=time", nil, nil))
	require.Len(t, matches, 2)
	require.Equal(t, 2, matches[0].RequestCount)
	require.Zero(t, matches[1].RequestCount)
	history := other.call("GET", shelfmarkRequestsPath, nil, nil)
	require.Equal(t, 200, history.status, string(history.body))
	require.Equal(t, matches[:1], decodeWeb[[]ShelfmarkBook](t, history))
	require.JSONEq(t, `[]`, string(other.call("GET", shelfmarkRequestsPath+"?offset=1", nil, nil).body))
	details := other.call("GET", shelfmarkRequestsPath+"/releases?provider=hardcover&id=69589", nil, nil)
	require.Equal(t, 200, details.status, string(details.body))
	require.Equal(t, []ShelfmarkRelease{queued, claim}, decodeWeb[[]ShelfmarkRelease](t, details))
	stored, err := f.db.Queries.GetShelfmarkRelease(t.Context(), queued.Key)
	require.NoError(t, err)
	require.Equal(t, queued.Key, stored.ReleaseKey)
}

func TestShelfmarkClaimSurvivesDisconnectWhileWaitingToWrite(t *testing.T) {
	f := newWebFixture(t)
	db := f.db.DB
	conn, err := db.Conn(t.Context())
	require.NoError(t, err)
	defer conn.Close()
	waiting := db.Stats().WaitCount
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := (&webAPI{f.api}).claimShelfmarkRelease(ctx, database.ClaimShelfmarkReleaseParams{ReleaseKey: "key"})
		result <- err
	}()
	require.Eventually(t, func() bool { return db.Stats().WaitCount > waiting }, 2*time.Second, time.Millisecond)
	cancel()
	require.NoError(t, conn.Close())
	require.NoError(t, <-result)
	_, err = f.db.Queries.GetShelfmarkRelease(t.Context(), "key")
	require.NoError(t, err)
}

func TestShelfmarkShutdownDrainsClaimAfterDisconnect(t *testing.T) {
	f := newWebFixture(t)
	entered, finish := make(chan struct{}), make(chan struct{})
	var unblock sync.Once
	end := func() { unblock.Do(func() { close(finish) }) }
	var posts atomic.Int32
	testShelfmark(t, f, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/releases":
			fmt.Fprint(w, `{"book":`+shelfmarkTestBook+`,"releases":`+shelfmarkTestReleases+`}`)
		case "/api/releases/download":
			if posts.Add(1) == 1 {
				close(entered)
			}
			<-finish
			fmt.Fprint(w, `{"status":"queued"}`)
		default:
			http.NotFound(w, r)
		}
	})
	t.Cleanup(end)
	f.register("reader")
	file := decodeWeb[ShelfmarkReleaseList](t, f.call("GET", shelfmarkReleasesPath+"?provider=hardcover&id=69589", nil, nil)).Releases[0]
	ctx, disconnect := context.WithCancel(t.Context())
	defer disconnect()
	req := f.newRequest("POST", shelfmarkRequestsPath, shelfmarkDownloadBody(file), nil).WithContext(ctx)
	returned := make(chan error, 1)
	go func() {
		res, err := f.client.Do(req)
		if res != nil {
			res.Body.Close()
		}
		returned <- err
	}()
	select {
	case <-entered:
	case <-time.After(4 * time.Second):
		t.Fatal("upstream submission never arrived")
	}
	disconnect()
	require.ErrorIs(t, <-returned, context.Canceled)
	stopped := make(chan error, 1)
	go func() { stopped <- f.api.Stop() }()
	select {
	case <-stopped:
		t.Fatal("shutdown returned before the upstream acknowledgement")
	case <-time.After(100 * time.Millisecond):
	}
	conn, err := f.db.DB.Conn(t.Context())
	require.NoError(t, err)
	defer conn.Close()
	waiting := f.db.DB.Stats().WaitCount
	end()
	require.Eventually(t, func() bool { return f.db.DB.Stats().WaitCount > waiting }, time.Second, time.Millisecond)
	select {
	case <-stopped:
		t.Fatal("shutdown discarded the acknowledgement while SQLite was occupied")
	case <-time.After(3200 * time.Millisecond): // Exceeds the former three-second settlement deadline.
	}
	require.NoError(t, conn.Close())
	require.NoError(t, <-stopped)
	row, err := f.db.Queries.GetShelfmarkRelease(t.Context(), file.Key)
	require.NoError(t, err)
	require.Equal(t, string(ShelfmarkQueued), row.State)
	require.EqualValues(t, 1, posts.Load())
}

func TestShelfmarkRejectedReleaseIsRecordedWithoutResubmission(t *testing.T) {
	f := newWebFixture(t)
	var posts atomic.Int32
	testShelfmark(t, f, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "GET /api/metadata/book/hardcover/69589":
			fmt.Fprint(w, shelfmarkTestBook)
		case "GET /api/releases":
			fmt.Fprint(w, `{"book":`+shelfmarkTestBook+`,"releases":`+shelfmarkTestReleases+`}`)
		case "POST /api/releases/download":
			posts.Add(1)
			w.WriteHeader(http.StatusForbidden)
			fmt.Fprint(w, `{"error":"policy refuses the download"}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	f.register("reader")
	listing := f.call("GET", shelfmarkReleasesPath+"?provider=hardcover&id=69589", nil, nil)
	require.Equal(t, 200, listing.status, string(listing.body))
	files := decodeWeb[ShelfmarkReleaseList](t, listing).Releases
	payload := shelfmarkDownloadBody(files[0])
	response := f.call("POST", shelfmarkRequestsPath, payload, nil)
	require.Equal(t, 200, response.status, string(response.body))
	rejected := decodeWeb[ShelfmarkDownloadResult](t, response).Release
	require.NotNil(t, rejected.Request)
	require.Equal(t, ShelfmarkRejected, rejected.Request.State)
	repeat := f.call("POST", shelfmarkRequestsPath, payload, nil)
	require.Equal(t, 200, repeat.status, string(repeat.body))
	require.Equal(t, rejected, decodeWeb[ShelfmarkDownloadResult](t, repeat).Release)
	require.EqualValues(t, 1, posts.Load())
}
