package metadata

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOpenLibraryISBNLookup(t *testing.T) {
	query := make(chan string, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query <- r.URL.Query().Get("q")
		fmt.Fprint(w, `{"docs":[{"key":"/works/OL1W","title":" Book ","author_name":["Author"],"cover_i":42,"isbn":["9780765391209","9780765391193"]},{"key":"/works/OL1W","title":"Duplicate"}]}`)
	}))
	defer server.Close()
	matches, err := lookupOpenLibrary(context.Background(), server.Client(), server.URL, "978-0765391193")
	require.NoError(t, err)
	require.Equal(t, "isbn:9780765391193", <-query)
	require.Len(t, matches, 1)
	require.Equal(t, "Book", matches[0].Title)
	require.Equal(t, "Author", matches[0].Author)
	require.NotNil(t, matches[0].CoverID)
	require.EqualValues(t, 42, *matches[0].CoverID)
	require.NotNil(t, matches[0].ISBN13)
	require.Equal(t, "9780765391193", *matches[0].ISBN13)
}

func TestOpenLibraryReportsRateLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusTooManyRequests) }))
	defer server.Close()
	_, err := lookupOpenLibrary(context.Background(), server.Client(), server.URL, "Book")
	require.ErrorContains(t, err, "429")
}
