package metadata

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOpenLibraryWorkAndEditionPreview(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/works/OL1W.json":
			fmt.Fprint(w, `{"title":"Work","description":{"value":"A proper synopsis."},"covers":[1]}`)
		case "/isbn/9780765391193.json":
			http.Redirect(w, r, "/books/OL2M.json", http.StatusFound)
		case "/books/OL2M.json":
			fmt.Fprint(w, `{"key":"/books/OL2M","works":[{"key":"/works/OL1W"}],"isbn_13":["9780765391193"],"covers":[42]}`)
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
	require.Equal(t, "OL2M", *match.EditionID)
	require.Equal(t, "9780765391193", *match.ISBN13)
	require.EqualValues(t, 42, *match.CoverID)
	match, err = resolveOpenLibrary(t.Context(), client, srv.URL, "OL1W", "", "")
	require.NoError(t, err)
	require.Nil(t, match.EditionID)
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
