package shelfmark

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const releaseJSON = `{"source":"prowlarr","source_id":"https://source.example/file?token=fake-token","title":"The Time Machine - Ebook","content_type":"book","format":"epub","language":null,"size":null,"indexer":"Indexer","download_url":"https://source.example/download?token=fake-token","extra":{"info_hash":"abc","formats":["epub","pdf"]},"on_behalf_of_user_id":3,"priority":42}`

func releaseResults(id string, rows ...string) string {
	return fmt.Sprintf(`{"book":%s,"releases":[%s],"errors":["source unavailable: fake-token"]}`,
		strings.Replace(bookJSON, `"69589"`, fmt.Sprintf("%q", id), 1), strings.Join(rows, ","))
}

func TestVerifyReleaseAuthor(t *testing.T) {
	for _, tc := range []struct{ fields, want string }{
		{`"author":" Source Author ","extra":{"author":"Other Author"}`, "Source Author"},
		{`"author":["Malformed Author"],"extra":{"author":"Index Author"}`, "Index Author"},
		{`"author":"  ","extra":{"author":"Index Author"}`, "Index Author"},
		{`"author":null,"extra":{"author":{"name":"Malformed Author"}}`, ""},
	} {
		item, ok := verifyRelease(json.RawMessage(`{"source":"prowlarr","source_id":"1","title":"Book","format":"epub",` + tc.fields + `}`))
		require.True(t, ok, tc.fields)
		require.Equal(t, tc.want, item.release.Author)
	}
}

func TestReleasesReturnBestBookMatchFirst(t *testing.T) {
	rows := []string{
		`{"source":"index","source_id":"1","title":"The Time Machinery"}`,
		`{"source":"index","source_id":"2","title":"Other work","extra":{"info":{"ISBN-13":123}}}`,
		`{"source":"index","source_id":"3","title":"Another work","author":"H. G. Wells"}`,
		`{"source":"index","source_id":"4","title":"The.Time.Machine [EPUB]"}`,
		`{"source":"index","source_id":"5","title":"THE TIME MACHINE"}`,
		`{"source":"index","source_id":"6","title":"H.G.Wells - The Time Machine [PDF]"}`,
		`{"source":"index","source_id":"7","title":"The Time Machine","extra":{"author":"H. G. Wells"}}`,
		`{"source":"index","source_id":"8","title":"Alternate title [0-8044-2957-X]"}`,
		`{"source":"index","source_id":"9","title":"Other edition title","extra":{"info":{"ISBN-13":["9780804429573"]}}}`,
	}
	c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, strings.Replace(releaseResults("69589", rows...), `"publish_year":`, `"isbn_13":"9780804429573","publish_year":`, 1))
	}, "")
	list, err := c.Releases(t.Context(), "hardcover", "69589")
	require.NoError(t, err)
	var titles []string
	for _, release := range list.Releases {
		titles = append(titles, release.Title)
	}
	require.Equal(t, []string{
		"H.G.Wells - The Time Machine [PDF]", "Alternate title [0-8044-2957-X]", "Other edition title",
		"The Time Machine", "THE TIME MACHINE", "The.Time.Machine [EPUB]",
		"Another work", "The Time Machinery", "Other work",
	}, titles)
}

func TestReleasesBindsBookAndHidesCredentials(t *testing.T) {
	var gets, posts atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			gets.Add(1)
		}
		if r.Header.Get("X-Api-Key") != testKey {
			t.Error("missing key")
		}
		switch r.Method + " " + r.URL.Path {
		case "GET /shelf/api/releases":
			q := r.URL.Query()
			if q.Get("provider") != "hardcover" || q.Get("content_type") != "ebook" || len(q) != 3 {
				t.Error("release search did not constrain provider and content type")
			}
			id := q.Get("book_id")
			if id == "mismatch" {
				fmt.Fprint(w, releaseResults("69589", releaseJSON))
				return
			}
			fmt.Fprint(w, releaseResults(id, releaseJSON, releaseJSON,
				`{"source":"newznab","source_id":"2","title":"Audiobooks: A History [MP3]","format":"mp3","content_type":"audiobook"}`,
				`{"source":"prowlarr","source_id":"3","title":"Unknown format","format":null,"extra":{"categories":[3030]}}`,
				`{"source":"newznab","source_id":"malformed","title":"Malformed torrent row","format":7}`,
			))
		case "POST /shelf/api/releases/download":
			posts.Add(1)
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode POST: %v", err)
			}
			if body["source_id"] != "https://source.example/file?token=fake-token" || body["content_type"] != "ebook" || body["download_url"] != "https://source.example/download?token=fake-token" {
				t.Error("selected release was not submitted exactly")
			}
			if extra, ok := body["extra"].(map[string]any); !ok || extra["info_hash"] != "abc" {
				t.Error("source-specific data was lost")
			}
			if body["priority"] != nil || body["on_behalf_of_user_id"] != nil {
				t.Error("unexpected action parameters propagated")
			}
			fmt.Fprint(w, `{"status":"queued","priority":0}`)
		default:
			t.Errorf("unexpected upstream call %v %v", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}, "/shelf")

	ctx := t.Context()
	out, err := c.Releases(ctx, "hardcover", "69589")
	require.NoError(t, err)
	require.True(t, out.Partial)
	require.Equal(t, "The Time Machine", out.Book.Title)
	require.Len(t, out.Releases, 3)
	item := out.Releases[0]
	require.Equal(t, "epub", item.Format)
	require.Empty(t, item.Size)
	require.Empty(t, item.Language)
	require.Equal(t, "Audiobooks: A History [MP3]", out.Releases[1].Title)
	require.Equal(t, "mp3", out.Releases[1].Format)
	require.Equal(t, "Unknown format", out.Releases[2].Title)
	require.Empty(t, out.Releases[2].Format)
	wire, err := json.Marshal(out)
	require.NoError(t, err)
	require.NotContains(t, string(wire), "fake-token")
	require.NotEmpty(t, item.Selection)
	sealed, err := selectionEncoding.DecodeString(item.Selection)
	require.NoError(t, err)
	require.NotContains(t, string(sealed), "fake-token")
	sealed[len(sealed)-1] ^= 1
	tampered := selectionEncoding.EncodeToString(sealed)
	restarted, err := New(c.base.String()+"/", testKey)
	require.NoError(t, err)
	anotherService, err := New(c.base.String()+"/another", testKey)
	require.NoError(t, err)
	rotatedKey, err := New(c.base.String(), "other-key")
	require.NoError(t, err)
	for _, tc := range []struct {
		name                     string
		client                   *Client
		provider, id, key, token string
	}{
		{"wrong provider", restarted, "openlibrary", "69589", item.Key, item.Selection},
		{"wrong book", restarted, "hardcover", "another-book", item.Key, item.Selection},
		{"wrong release", restarted, "hardcover", "69589", out.Releases[1].Key, item.Selection},
		{"wrong service", anotherService, "hardcover", "69589", item.Key, item.Selection},
		{"rotated service key", rotatedKey, "hardcover", "69589", item.Key, item.Selection},
		{"tampered token", restarted, "hardcover", "69589", item.Key, tampered},
		{"oversized token", restarted, "hardcover", "69589", item.Key, strings.Repeat("x", MaxSelectionLength+1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := tc.client.OpenSelection(tc.provider, tc.id, tc.key, tc.token)
			require.ErrorIs(t, err, ErrInvalidSelection)
		})
	}
	book, release, err := restarted.OpenSelection("hardcover", "69589", item.Key, item.Selection)
	require.NoError(t, err)
	want := out.Book
	want.Description = ""
	require.Equal(t, want, book)
	require.Equal(t, item.Key, release.Key)
	require.Equal(t, item.Title, release.Title)
	require.ErrorIs(t, restarted.Download(ctx, item), ErrInvalidSelection)
	require.NoError(t, restarted.Download(ctx, release))
	require.EqualValues(t, 1, gets.Load(), "opening and downloading a release must not read upstream")
	require.EqualValues(t, 1, posts.Load())

	other, err := c.Releases(ctx, "hardcover", "another-book")
	require.NoError(t, err)
	require.Equal(t, item.Key, other.Releases[0].Key)
	_, err = c.Releases(ctx, "hardcover", "mismatch")
	require.Error(t, err)
}

func TestDownloadDoesNotRetryAndClassifiesDefiniteRefusals(t *testing.T) {
	for _, tc := range []struct {
		name     string
		code     int
		body     string
		rejected bool
	}{
		{"queued", 200, `{"status":"queued"}`, false},
		{"unrecognized acknowledgement", 200, `{"status":"fake-token"}`, false},
		{"forbidden", 403, `{"error":"fake-token"}`, true},
		{"already queued", 500, `{"error":"Release is already in the download queue"}`, true},
		{"bad gateway", 502, `{"error":"fake-token"}`, false},
		{"redirect", 307, ``, false},
		{"lost response", 0, ``, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var posts atomic.Int32
			c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet {
					fmt.Fprint(w, releaseResults("69589", releaseJSON))
					return
				}
				posts.Add(1)
				if tc.code == 0 {
					conn, _, err := http.NewResponseController(w).Hijack()
					if err != nil {
						t.Error(err)
						return
					}
					conn.Close()
					return
				}
				w.Header().Set("Location", "/should-not-follow")
				w.WriteHeader(tc.code)
				fmt.Fprint(w, tc.body)
			}, "")
			out, err := c.Releases(t.Context(), "hardcover", "69589")
			require.NoError(t, err)
			item := out.Releases[0]
			_, release, err := c.OpenSelection("hardcover", "69589", item.Key, item.Selection)
			require.NoError(t, err)
			cancelled, cancel := context.WithCancel(t.Context())
			cancel()
			require.ErrorIs(t, c.Download(cancelled, release), ErrRejected)
			require.Zero(t, posts.Load())

			err = c.Download(t.Context(), release)
			if tc.name == "queued" {
				require.NoError(t, err)
			} else if tc.rejected {
				require.ErrorIs(t, err, ErrRejected)
			} else {
				require.Error(t, err)
				require.NotErrorIs(t, err, ErrRejected)
			}
			if err != nil {
				require.NotContains(t, err.Error(), "fake-token")
			}
			require.EqualValues(t, 1, posts.Load())
		})
	}
}

func TestReleaseTimeoutsHonorCallerAndDoNotRetryDownload(t *testing.T) {
	var posts atomic.Int32
	c := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			posts.Add(1)
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{"status":`)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			return
		}
		switch r.URL.Query().Get("book_id") {
		case "slow":
			<-r.Context().Done()
		case "empty":
			fmt.Fprint(w, strings.Replace(releaseResults("empty"), `"errors":["source unavailable: fake-token"]`, `"errors":[]`, 1))
		default:
			fmt.Fprint(w, releaseResults("69589", releaseJSON))
		}
	}, "")
	ctx, cancel := context.WithTimeout(t.Context(), 150*time.Millisecond)
	defer cancel()
	_, err := c.Releases(ctx, "hardcover", "slow")
	require.ErrorIs(t, err, context.DeadlineExceeded)
	out, err := c.Releases(t.Context(), "hardcover", "empty")
	require.NoError(t, err)
	require.NotNil(t, out.Releases)
	require.Empty(t, out.Releases)
	require.False(t, out.Partial)
	out, err = c.Releases(t.Context(), "hardcover", "69589")
	require.NoError(t, err)
	item := out.Releases[0]
	_, release, err := c.OpenSelection("hardcover", "69589", item.Key, item.Selection)
	require.NoError(t, err)
	ctx, cancel = context.WithTimeout(t.Context(), 150*time.Millisecond)
	defer cancel()
	err = c.Download(ctx, release)
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrRejected)
	require.EqualValues(t, 1, posts.Load())
}
