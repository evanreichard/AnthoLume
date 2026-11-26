package shelfmark

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
)

const testKey = "test-key-not-a-secret"

func testClient(t *testing.T, handler http.HandlerFunc, prefix string) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	c, err := New(srv.URL+prefix, testKey)
	require.NoError(t, err)
	return c
}

const bookJSON = `{"provider":"hardcover","provider_id":"69589","title":"The Time Machine","authors":["H. G. Wells"],"publish_year":1895,"description":"Description","cover_url":"https://assets.hardcover.app/cover.jpg"}`

func TestMetadataAndVerifiedBook(t *testing.T) {
	var calls atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("X-Api-Key") != testKey {
			t.Error("missing key")
		}
		switch r.URL.Path {
		case "/shelf/api/metadata/search":
			if r.URL.Query().Get("query") != "Wells & friends" {
				t.Error("query encoding lost input")
			}
			fmt.Fprint(w, `{"books":[`+bookJSON+`,{"provider":"bad/id","provider_id":"1","title":"Unsafe"}]}`)
		case "/shelf/api/metadata/book/hardcover/69589", "/shelf/api/metadata/book/hardcover/123":
			fmt.Fprint(w, bookJSON)
		default:
			http.NotFound(w, r)
		}
	}, "/shelf/")
	ctx := t.Context()
	rows, err := c.Search(ctx, " Wells & friends ")
	require.NoError(t, err)
	require.Equal(t, []Book{{Provider: "hardcover", ID: "69589", Title: "The Time Machine", Author: "H. G. Wells", Description: "Description", Year: 1895, HasCover: true}}, rows)
	c.http.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host == "assets.hardcover.app" {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("\xff\xd8\xffJPEG"))}, nil
		}
		return http.DefaultTransport.RoundTrip(r)
	})
	_, _, err = c.Cover(ctx, "hardcover", "69589")
	require.NoError(t, err)
	require.EqualValues(t, 1, calls.Load(), "search already supplied this cover")
	book, err := c.Book(ctx, "hardcover", "69589")
	require.NoError(t, err)
	require.Equal(t, rows[0], book)
	_, err = c.Book(ctx, "hardcover", "123")
	require.ErrorContains(t, err, "did not match")
	for _, id := range []string{"%2F", "../requests", "x?source=hardcover"} {
		_, err = c.Book(ctx, "hardcover", id)
		require.Error(t, err)
	}
	require.EqualValues(t, 3, calls.Load())
}

func TestCoverFetchUsesOnlyVerifiedPublishedAssetWithoutKey(t *testing.T) {
	const external = "https://assets.hardcover.app/cover.jpg"
	const path = "/shelf/api/covers/hardcover_69589?url="
	valid := path + base64.URLEncoding.EncodeToString([]byte(external))
	for _, asset := range []struct {
		url   string
		fetch bool
	}{
		{external, true}, {valid, true},
		{path + base64.URLEncoding.EncodeToString([]byte("https://127.0.0.1/secret")), false},
		{"/api/covers/hardcover_69589?url=" + base64.URLEncoding.EncodeToString([]byte(external)), false},
		{valid + "&next=https://127.0.0.1/secret", false},
		{"https://assets.hardcover.app@evil.example/image", false},
		{"https://assets.hardcover.app.evil.example/image", false},
		{"https://assets.hardcover.app:443/image", false},
		{"http://assets.hardcover.app/image", false},
	} {
		t.Run(asset.url, func(t *testing.T) {
			c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/shelf/api/metadata/book/hardcover/69589" {
					t.Errorf("unexpected path %s", r.URL.Path)
				}
				fmt.Fprint(w, strings.Replace(bookJSON, external, asset.url, 1))
			}, "/shelf")
			var fetched atomic.Bool
			c.http.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				if r.URL.Scheme == "http" {
					return http.DefaultTransport.RoundTrip(r)
				}
				fetched.Store(true)
				if !asset.fetch || r.URL.String() != external || r.Header.Get("X-Api-Key") != "" || r.Header.Get("Authorization") != "" {
					t.Error("unsafe asset request")
				}
				return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader("\xff\xd8\xffJPEG"))}, nil
			})
			_, kind, err := c.Cover(t.Context(), "hardcover", "69589")
			if asset.fetch {
				require.NoError(t, err)
				require.Equal(t, "image/jpeg", kind)
			} else {
				require.ErrorIs(t, err, ErrNotFound)
			}
			require.Equal(t, asset.fetch, fetched.Load())
		})
	}
}

func TestCreateNeverRetriesAndClassifiesRefusals(t *testing.T) {
	for _, tc := range []struct {
		status   int
		body     string
		id       int64
		rejected bool
	}{
		{201, `{"id":8}`, 8, false}, {201, `{"id":0}`, 0, false}, {200, `{"id":8}`, 0, false},
		{403, `{"error":"blocked","code":"policy_blocked"}`, 0, true}, {403, `<html>Forbidden</html>`, 0, false},
		{409, `{"error":"duplicate","code":"duplicate_pending_request"}`, 0, false},
		{502, `{"error":"upstream failed"}`, 0, false}, {307, ``, 0, false},
	} {
		t.Run(strconv.Itoa(tc.status)+tc.body, func(t *testing.T) {
			var posts atomic.Int32
			c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
				posts.Add(1)
				if r.URL.Path != "/api/requests" || r.Method != http.MethodPost || r.Header.Get("X-Api-Key") != testKey {
					t.Error("unexpected request")
				}
				var payload map[string]any
				if json.NewDecoder(r.Body).Decode(&payload) != nil {
					t.Error("bad payload")
				}
				ctx, _ := payload["context"].(map[string]any)
				data, _ := payload["book_data"].(map[string]any)
				if ctx["request_level"] != "book" || ctx["content_type"] != "ebook" || payload["release_data"] != nil || data["provider_id"] != "69589" {
					t.Errorf("unexpected payload %v", payload)
				}
				if tc.status == 307 {
					w.Header().Set("Location", "/must-not-follow")
				}
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}, "")
			id, err := c.Create(t.Context(), Book{Provider: "hardcover", ID: "69589", Title: "The Time Machine"})
			require.Equal(t, tc.id, id)
			require.Equal(t, tc.rejected, errors.Is(err, ErrRejected))
			require.Equal(t, tc.id == 0, err != nil)
			require.EqualValues(t, 1, posts.Load())
		})
	}
}

func TestFindPagesAndMatchesOnlyAnEbookBookRequest(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/requests" || r.URL.Query().Get("limit") != strconv.Itoa(pageSize) {
			t.Error("unexpected page request")
		}
		switch r.URL.Query().Get("offset") {
		case "0":
			fmt.Fprint(w, `[`+strings.TrimSuffix(strings.Repeat(`{"id":2,"request_level":"release","content_type":"ebook","book_data":{"provider":"hardcover","provider_id":"69589"}},`, pageSize), ",")+`]`)
		case strconv.Itoa(pageSize):
			fmt.Fprint(w, `[{"id":7,"request_level":"book","content_type":"audiobook","book_data":{"provider":"hardcover","provider_id":"69589"}},{"id":8,"request_level":"book","content_type":"ebook","book_data":{"provider":"hardcover","provider_id":"69589"}}]`)
		default:
			t.Error("unexpected additional page")
		}
	}, "")
	id, err := c.Find(t.Context(), "hardcover", "69589")
	require.NoError(t, err)
	require.EqualValues(t, 8, id)
	id, err = c.Find(t.Context(), "openlibrary", "69589")
	require.NoError(t, err)
	require.Zero(t, id)
}

func TestFindAfterLostCreateResponse(t *testing.T) {
	var writes atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			writes.Add(1)
			conn, _, err := http.NewResponseController(w).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			conn.Close()
			return
		}
		if writes.Load() == 1 {
			fmt.Fprint(w, `[{"id":42,"request_level":"book","content_type":"ebook","book_data":{"provider":"hardcover","provider_id":"69589"}}]`)
		}
	}, "")
	id, err := c.Create(t.Context(), Book{Provider: "hardcover", ID: "69589", Title: "The Time Machine"})
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrRejected)
	require.Zero(t, id)
	id, err = c.Find(t.Context(), "hardcover", "69589")
	require.NoError(t, err)
	require.EqualValues(t, 42, id)
	require.EqualValues(t, 1, writes.Load())
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
