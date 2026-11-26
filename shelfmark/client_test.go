package shelfmark

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
