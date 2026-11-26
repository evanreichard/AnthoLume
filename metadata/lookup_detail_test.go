package metadata

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOpenLibraryWorkAndEditionPreview(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/works/OL1W.json":
			fmt.Fprint(w, `{"key":"/works/OL1W","title":"Work","description":{"value":"A proper synopsis."},"covers":[1],"authors":[{"author":{"key":"/authors/OL7A"}}]}`)
		case "/authors/OL7A.json":
			fmt.Fprint(w, `{"key":"/authors/OL7A","name":" Work Author "}`)
		case "/isbn/9780765391193.json":
			http.Redirect(w, r, "/books/OL2M.json", http.StatusFound)
		case "/books/OL2M.json":
			fmt.Fprint(w, `{"key":"/books/OL2M","works":[{"key":"/works/OL1W"}],"isbn_13":["9780765391193"],"covers":[42]}`)
		case "/books/OL7M.json":
			fmt.Fprint(w, `{"key":"/books/OL7M","works":[{"key":"/works/OL1W"}],"isbn_10":["0765391198"],"isbn_13":["9780765391193"],"covers":[-1]}`)
		case "/books/OL6M.json":
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
		case "/books/OL3M.json":
			fmt.Fprint(w, `{"key":"/books/OL3M","works":[{"key":"/works/OL4W"}],"covers":[99]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	client := srv.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	match, err := resolveOpenLibrary(context.Background(), client, srv.URL, "OL1W", "OL3M", "9780765391193")
	require.NoError(t, err)
	require.Equal(t, "A proper synopsis.", *match.Description)
	require.Equal(t, "Work Author", match.Author)
	require.Equal(t, "OL2M", *match.EditionID)
	require.Equal(t, "9780765391193", *match.ISBN13)
	require.EqualValues(t, 42, *match.CoverID)
	match, err = resolveOpenLibrary(t.Context(), client, srv.URL, "OL1W", "", "")
	require.NoError(t, err)
	require.Nil(t, match.EditionID)
	require.Nil(t, match.ISBN10)
	require.Nil(t, match.ISBN13)
	require.EqualValues(t, 1, *match.CoverID)
	match, err = resolveOpenLibrary(t.Context(), client, srv.URL, "OL1W", "OL7M", "")
	require.NoError(t, err)
	require.Equal(t, "OL7M", *match.EditionID)
	require.Equal(t, "0765391198", *match.ISBN10)
	require.Equal(t, "9780765391193", *match.ISBN13)
	require.EqualValues(t, 1, *match.CoverID)
	match, err = resolveOpenLibrary(context.Background(), client, srv.URL, "OL1W", "OL3M", "")
	require.NoError(t, err)
	require.NotNil(t, match.Description)
	require.Nil(t, match.EditionID)
	require.Nil(t, match.CoverID)
	match, err = resolveOpenLibrary(t.Context(), client, srv.URL, "OL1W", "OL5M", "")
	require.NoError(t, err)
	require.Nil(t, match.EditionID)
	_, err = resolveOpenLibrary(t.Context(), client, srv.URL, "OL1W", "OL6M", "")
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrInvalidLookupMatch)
}

func TestOpenLibraryOptionalAuthors(t *testing.T) {
	const first = `{"author":{"key":"/authors/OL1A"}}`
	const second = `{"author":{"key":"/authors/OL2A"}}`
	validFirst := `{"key":"/authors/OL1A","name":" First Author "}`
	for _, tc := range []struct {
		name, credits, record, want string
		requests                    int
	}{
		{"no credits", `null`, "", "", 0},
		{"unknown credit shape", `{"author":"bad"}`, "", "", 0},
		{"invalid key", `[{"author":{"key":"/authors/../../other"}}]`, "", "", 0},
		{"too many IDs", `[` + first + `,` + second + `,` + strings.ReplaceAll(first, "OL1A", "OL3A") + `,` + strings.ReplaceAll(first, "OL1A", "OL4A") + `,` + strings.ReplaceAll(first, "OL1A", "OL5A") + `]`, "", "", 0},
		{"missing author record", `[` + first + `]`, "", "", 1},
		{"incomplete author list", `[` + second + `,` + first + `]`, "", "", 2},
		{"mismatched key", `[` + first + `]`, `{"key":"/authors/OL2A","name":"Wrong Author"}`, "", 1},
		{"missing name", `[` + first + `]`, `{"key":"/authors/OL1A","name":" "}`, "", 1},
		{"invalid name", `[` + first + `]`, `{"key":"/authors/OL1A","name":"Bad\u0000Name"}`, "", 1},
		{"ordered distinct authors", `[` + first + `,` + second + `,` + first + `]`, validFirst, "First Author, Second Author", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var authorRequests atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/works/OL1W.json":
					fmt.Fprintf(w, `{"key":"/works/OL1W","title":"Work","description":"Work synopsis","authors":%s}`, tc.credits)
				case "/authors/OL1A.json":
					authorRequests.Add(1)
					if tc.record == "" {
						http.NotFound(w, r)
					} else {
						fmt.Fprint(w, tc.record)
					}
				case "/authors/OL2A.json":
					authorRequests.Add(1)
					fmt.Fprint(w, `{"key":"/authors/OL2A","name":"Second Author"}`)
				default:
					t.Errorf("unexpected request %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer srv.Close()
			match, err := resolveOpenLibrary(t.Context(), srv.Client(), srv.URL, "OL1W", "", "")
			require.NoError(t, err)
			require.Equal(t, tc.want, match.Author)
			require.Equal(t, "Work synopsis", *match.Description)
			require.Nil(t, match.CoverID)
			require.EqualValues(t, tc.requests, authorRequests.Load())
		})
	}
}
