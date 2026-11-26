package hardcover

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/matcherquota"
	"reichard.io/antholume/metadata"
)

type matcherTransport func(*http.Request) (*http.Response, error)

func (f matcherTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestCatalogMatcherBatchesAndSharesProviderQuota(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var calls []time.Duration
		var emitted []string
		start := time.Now()
		catalog := NewCatalog(testCatalogToken)
		catalog.http.Transport = matcherTransport(func(r *http.Request) (*http.Response, error) {
			calls = append(calls, time.Since(start))
			require.Equal(t, "Bearer "+testCatalogToken, r.Header.Get("Authorization"))
			var req catalogRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
			var reply string
			switch len(calls) {
			case 1:
				require.Contains(t, req.Query, "editions(where: $where")
				require.Equal(t, float64(80), req.Variables["limit"])
				require.Equal(t, map[string]any{"_or": []any{
					map[string]any{"isbn_10": map[string]any{"_in": []any{"080442957X"}}},
					map[string]any{"isbn_13": map[string]any{"_in": []any{"9780804429573", "9781234567890"}}},
				}}, req.Variables["where"])
				reply = `{"data":{"editions":[` + otherEditionRow + `,` + editionRow + `]}}`
			case 2:
				require.Equal(t, []string{"a"}, emitted)
				require.Equal(t, map[string]any{"book0": "Other Jane Doe", "book1": "Gone", "book2": "Provider error"}, req.Variables)
				require.Contains(t, req.Query, "book0: search(query: $book0")
				require.Contains(t, req.Query, "book2: search(query: $book2")
				require.NotContains(t, req.Query, "Other Jane Doe")
				reply = `{"data":{"book1":{"results":{"hits":[]}},"book0":{"results":{"hits":[{"document":{"id":"17","title":"Other","author_names":["Jane Doe"]}}]}},"book2":null},"errors":[{"path":["book2"],"message":"provider secret"}]}`
			case 3:
				require.Equal(t, []string{"a", "b", "none", "error"}, emitted)
				require.Equal(t, map[string]any{"book0": "Last search"}, req.Variables)
				reply = `{"data":{"book0":{"results":{"hits":[]}}}}`
			case 4:
				reply = `{"data":{"editions":[` + editionRow + `]}}`
			case 5:
				require.Equal(t, map[string]any{"book0": "Limited book"}, req.Variables)
				return &http.Response{StatusCode: http.StatusTooManyRequests, Header: http.Header{"Retry-After": {"20"}},
					Body: io.NopCloser(strings.NewReader(`{"errors":[{"message":"rate limited"}]}`))}, nil
			default:
				t.Fatalf("unexpected catalog call %v", req)
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(reply))}, nil
		})
		books := []metadata.MatcherInput{
			{ID: "a", ISBN: "9780804429573"},
			{ID: "b", ISBN: "9781234567890", Title: "Other", Author: "Jane Doe"},
			{ID: "none", Title: "Gone"},
			{ID: "error", Title: "Provider error"},
			{ID: "last", Title: "Last search"},
		}
		err := catalog.LookupMatcherBatch(t.Context(), books, func(id string, results []metadata.LookupMatch, err error) error {
			emitted = append(emitted, id)
			switch id {
			case "a":
				require.NoError(t, err)
				require.Len(t, results, 1)
				require.Equal(t, "42", results[0].ID)
				require.Equal(t, "99", *results[0].EditionID)
				require.Equal(t, "9780804429573", *results[0].ISBN13)
			case "b":
				require.NoError(t, err)
				require.Len(t, results, 1)
				require.Equal(t, "17", results[0].ID)
				require.Nil(t, results[0].EditionID)
			case "error":
				require.Empty(t, results)
				require.ErrorIs(t, err, ErrProvider)
				require.NotContains(t, err.Error(), "provider secret")
			default:
				require.NoError(t, err)
				require.Empty(t, results)
			}
			return nil
		})
		require.NoError(t, err)
		_, err = catalog.Resolve(t.Context(), "42", "99", "9780804429573")
		require.NoError(t, err)

		err = catalog.LookupMatcherBatch(t.Context(), []metadata.MatcherInput{{ID: "limited", Title: "Limited book"}}, func(id string, results []metadata.LookupMatch, err error) error {
			emitted = append(emitted, id)
			require.ErrorIs(t, err, matcherquota.ErrLimited)
			require.Empty(t, results)
			return nil
		})
		require.NoError(t, err)
		require.Equal(t, []string{"a", "b", "none", "error", "last", "limited"}, emitted)
		_, err = catalog.Resolve(t.Context(), "42", "", "")
		require.ErrorIs(t, err, matcherquota.ErrLimited)
		require.Equal(t, []time.Duration{0, time.Second, 4 * time.Second, 5 * time.Second, 6 * time.Second}, calls)
	})
}
