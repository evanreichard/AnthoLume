package api

import (
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
	"reichard.io/antholume/shelfmark"
)

const shelfmarkRequestsPath = "/api/v1/shelfmark/requests"

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
	assertProblem(t, f.call("GET", search, nil, nil), 409, "shelfmark_disabled")
	assertProblem(t, f.call("GET", "/api/v1/shelfmark/cover?provider=hardcover&id=69589", nil, nil), 409, "shelfmark_disabled")
	assertProblem(t, f.call("GET", shelfmarkRequestsPath, nil, nil), 409, "shelfmark_disabled")
	assertProblem(t, f.call("POST", shelfmarkRequestsPath, map[string]string{"provider": "hardcover", "id": "69589"}, nil), 409, "shelfmark_disabled")
}

func TestShelfmarkSharedClaimAndLostResponse(t *testing.T) {
	f := newWebFixture(t)
	entered, letAccept := make(chan struct{}), make(chan struct{})
	var release sync.Once
	finish := func() { release.Do(func() { close(letAccept) }) }
	var accepted atomic.Bool
	var posts atomic.Int32
	const book = `{"provider":"hardcover","provider_id":"69589","title":"The Time Machine","authors":["H. G. Wells"],"publish_year":1895}`
	testShelfmark(t, f, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "GET" && r.URL.Path == "/api/metadata/book/hardcover/69589":
			fmt.Fprint(w, book)
		case r.Method == "GET" && r.URL.Path == "/api/metadata/search":
			fmt.Fprint(w, `{"books":[`+book+`,{"provider":"openlibrary","provider_id":"69589","title":"Different provider"}]}`)
		case r.Method == "POST" && r.URL.Path == "/api/requests":
			var payload struct {
				Context  map[string]string `json:"context"`
				BookData map[string]string `json:"book_data"`
				Release  json.RawMessage   `json:"release_data"`
			}
			if json.NewDecoder(r.Body).Decode(&payload) != nil || payload.Context["request_level"] != "book" || payload.Context["content_type"] != "ebook" || payload.BookData["title"] != "The Time Machine" || payload.Release != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if posts.Add(1) == 1 {
				close(entered)
			}
			<-letAccept
			accepted.Store(true)
			conn, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				conn.Close()
			}
		case r.Method == "GET" && r.URL.Path == "/api/requests":
			if !accepted.Load() {
				fmt.Fprint(w, `[]`)
				return
			}
			fmt.Fprint(w, `[{"id":101,"request_level":"book","content_type":"ebook","book_data":`+book+`}]`)
		default:
			w.WriteHeader(404)
		}
	})
	t.Cleanup(finish)
	f.register("alex")
	other := *f
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	other.client = &http.Client{Jar: jar, Timeout: 5 * time.Second}
	other.register("sam")
	assertProblem(t, other.call("PUT", "/api/v1/admin/shelfmark", map[string]bool{"enabled": false}, nil), 403, "forbidden")
	payload := map[string]string{"provider": "hardcover", "id": "69589"}
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
	claim := decodeWeb[ShelfmarkBook](t, shared).Request
	require.NotNil(t, claim)
	require.Equal(t, "alex", claim.Username)
	require.Equal(t, Confirming, claim.State)
	require.EqualValues(t, 1, posts.Load())

	finish()
	out := <-done
	require.NoError(t, out.err)
	require.Equal(t, 200, out.response.status, string(out.response.body))
	require.Equal(t, Confirming, decodeWeb[ShelfmarkBook](t, out.response).Request.State)
	recheck := other.call("POST", shelfmarkRequestsPath, map[string]any{"provider": "hardcover", "id": "69589", "check_only": true}, nil)
	require.Equal(t, 200, recheck.status, string(recheck.body))
	expected := *claim
	expected.State = Requested
	require.Equal(t, expected, *decodeWeb[ShelfmarkBook](t, recheck).Request)
	require.EqualValues(t, 1, posts.Load())

	results := other.call("GET", "/api/v1/shelfmark/search?q=time", nil, nil)
	require.Equal(t, 200, results.status, string(results.body))
	matches := decodeWeb[[]ShelfmarkBook](t, results)
	require.Len(t, matches, 2)
	require.Equal(t, &expected, matches[0].Request)
	require.Nil(t, matches[1].Request)
	history := other.call("GET", shelfmarkRequestsPath, nil, nil)
	require.Equal(t, 200, history.status, string(history.body))
	require.Equal(t, matches[:1], decodeWeb[[]ShelfmarkBook](t, history))
	require.JSONEq(t, `[]`, string(other.call("GET", shelfmarkRequestsPath+"?offset=1", nil, nil).body))
}

func TestShelfmarkRejectionReleasesClaim(t *testing.T) {
	f := newWebFixture(t)
	var posts atomic.Int32
	testShelfmark(t, f, func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "GET /api/metadata/book/hardcover/69589":
			fmt.Fprint(w, `{"provider":"hardcover","provider_id":"69589","title":"The Time Machine"}`)
		case "POST /api/requests":
			if posts.Add(1) == 1 {
				w.WriteHeader(http.StatusForbidden)
				fmt.Fprint(w, `{"error":"policy refuses the request"}`)
				return
			}
			w.WriteHeader(http.StatusCreated)
			fmt.Fprint(w, `{"id":102}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	f.register("reader")
	payload := map[string]string{"provider": "hardcover", "id": "69589"}
	assertProblem(t, f.call("POST", shelfmarkRequestsPath, map[string]any{"provider": "hardcover", "id": "69589", "check_only": true}, nil), 404, "shelfmark_request_not_found")
	require.Zero(t, posts.Load())
	assertProblem(t, f.call("POST", shelfmarkRequestsPath, payload, nil), 502, "shelfmark_request_rejected")
	require.JSONEq(t, `[]`, string(f.call("GET", shelfmarkRequestsPath, nil, nil).body))
	response := f.call("POST", shelfmarkRequestsPath, payload, nil)
	require.Equal(t, 200, response.status, string(response.body))
	require.Equal(t, Requested, decodeWeb[ShelfmarkBook](t, response).Request.State)
	require.EqualValues(t, 2, posts.Load())
}
