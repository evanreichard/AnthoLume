package metadata

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/matcherquota"
)

type openLibraryFake func(*http.Request) (*http.Response, error)

func (f openLibraryFake) Do(r *http.Request) (*http.Response, error) { return f(r) }

func TestMatcherOpenLibraryBatchesISBNAndRequiresDirectEvidence(t *testing.T) {
	var calls, delivered []string
	upstream := openLibraryFake(func(req *http.Request) (*http.Response, error) {
		q := req.URL.Query().Get("q")
		if q == "" {
			q = req.URL.Path
		}
		calls = append(calls, q)
		var result string
		switch len(calls) {
		case 1:
			require.Equal(t, "(isbn:080442957X OR isbn:9780804429573 OR isbn:9781234567890)", q)
			require.Contains(t, req.URL.Query().Get("fields"), ",isbn")
			result = `{"docs":[
{"key":"/works/OL99W","title":"Unrelated","isbn":["9780804429953"]},
{"key":"/works/OL1W","title":"Book","author_name":["Author"],"cover_edition_key":"OL11M","isbn":["080442957X"]},
{"key":"/works/OL12W","title":"Another work","cover_edition_key":"OL12M","isbn":["080442957X"]},
{"key":"/works/OL88W","title":"No evidence"}
]}`
		case 2:
			require.Equal(t, "/isbn/080442957X.json", q)
			result = `{"key":"/books/OL22M","works":[{"key":"/works/OL1W"}],"isbn_10":["080442957X"]}`
		case 3:
			require.Equal(t, []string{"a", "duplicate"}, delivered)
			require.Equal(t, "Other Jane Doe", q)
			result = `{"docs":[{"key":"/works/OL3W","title":"Other sequel","author_name":["Jane Doe"]},{"key":"/works/OL2W","title":"Other","author_name":["Jane Doe"],"cover_edition_key":"OL88M"}]}`
		case 4:
			require.Equal(t, "No match", q)
			result = `{"docs":[]}`
		default:
			t.Fatalf("unexpected catalog call %q", q)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(result))}, nil
	})
	books := []MatcherInput{
		{ID: "a", Title: "Book", Author: "Author", ISBN: "978-0804429573"},
		{ID: "b", Title: "Other", Author: "Jane Doe", ISBN: "9781234567890"},
		{ID: "duplicate", ISBN: "080442957X"},
		{ID: "none", Title: "No match"},
	}
	err := lookupOpenLibraryMatcher(t.Context(), upstream, "https://openlibrary.invalid/search.json", books, func(id string, results []LookupMatch, err error) error {
		require.NoError(t, err)
		delivered = append(delivered, id)
		switch id {
		case "a", "duplicate":
			require.Len(t, results, 2)
			require.Equal(t, "OL1W", results[0].ID)
			require.Equal(t, "080442957X", *results[0].ISBN10)
			require.Equal(t, "OL22M", *results[0].EditionID)
			require.Equal(t, "OL12W", results[1].ID)
			require.Nil(t, results[1].EditionID)
		case "b":
			require.Len(t, results, 2)
			require.Equal(t, "OL2W", results[0].ID)
			require.Nil(t, results[0].ISBN13)
			require.Nil(t, results[0].EditionID)
		case "none":
			require.Empty(t, results)
		}
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, []string{"a", "duplicate", "b", "none"}, delivered)
	require.Len(t, calls, 4)
}

func TestMatcherOpenLibrarySeparatesProviderErrorAndStopsOnEmitError(t *testing.T) {
	calls := 0
	upstream := openLibraryFake(func(req *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 429, Body: io.NopCloser(strings.NewReader("rate limited"))}, nil
	})
	stop := errors.New("stream disconnected")
	err := lookupOpenLibraryMatcher(t.Context(), upstream, "https://openlibrary.invalid/search.json", []MatcherInput{{ID: "a", ISBN: "9780804429573"}, {ID: "b", Title: "Other"}}, func(id string, results []LookupMatch, err error) error {
		require.Equal(t, "a", id)
		require.Empty(t, results)
		require.ErrorIs(t, err, matcherquota.ErrLimited)
		return stop
	})
	require.ErrorIs(t, err, stop)
	require.Equal(t, 1, calls)

	err = lookupOpenLibraryMatcher(t.Context(), upstream, "https://openlibrary.invalid/search.json", []MatcherInput{{ID: "a"}, {ID: "a"}}, func(string, []LookupMatch, error) error {
		return fmt.Errorf("invalid batches do not emit")
	})
	require.ErrorIs(t, err, ErrInvalidMatcherBatch)
	require.Equal(t, 1, calls)
}
