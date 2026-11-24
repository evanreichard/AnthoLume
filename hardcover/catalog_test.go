package hardcover

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"reichard.io/antholume/metadata"
)

const testCatalogToken = "synthetic-SENSITIVE-catalog-credential"

type catalogRequest struct {
	Query     string         `json:"query"`
	Variables map[string]any `json:"variables"`
}

func testCatalog(t *testing.T, handle func(http.ResponseWriter, catalogRequest)) *Catalog {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer "+testCatalogToken, r.Header.Get("Authorization"))
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/v1/graphql", r.URL.RequestURI())
		raw, err := io.ReadAll(r.Body)
		assert.NoError(t, err)
		assert.NotContains(t, string(raw), testCatalogToken)
		var req catalogRequest
		if assert.NoError(t, json.Unmarshal(raw, &req)) {
			handle(w, req)
		}
	}))
	t.Cleanup(srv.Close)
	c := NewCatalog(testCatalogToken)
	c.endpoint = srv.URL + "/v1/graphql"
	return c
}

func TestCatalogTextSearch(t *testing.T) {
	for _, text := range []string{"Project Hail Mary", "Andy Weir", "Project Hail Mary Andy Weir"} {
		t.Run(text, func(t *testing.T) {
			c := testCatalog(t, func(w http.ResponseWriter, r catalogRequest) {
				assert.Contains(t, r.Query, `search(query: $q, query_type: "Book", fields: "title,author_names,alternative_titles"`)
				assert.Equal(t, text, r.Variables["q"])
				fmt.Fprint(w, `{"data":{"search":{"error":null,"results":{"found":1,"hits":[{"document":{"id":"42","title":"Project Hail Mary","author_names":["Andy Weir"],"release_year":2021,"image":{"id":12345}}}]}}}}`)
			})
			matches, err := c.Lookup(t.Context(), text)
			require.NoError(t, err)
			require.Len(t, matches, 1)
			require.Equal(t, "42", matches[0].ID)
			require.Equal(t, "Andy Weir", matches[0].Author)
			require.Nil(t, matches[0].EditionID)
			require.NotNil(t, matches[0].CoverID)
			require.EqualValues(t, 12345, *matches[0].CoverID)
		})
	}
}

const workRow = `{"id":42,"title":"Verified Work","description":"Work synopsis","release_year":2017,"contributions":[{"author":{"name":"Verified Author"}}]}`
const editionRow = `{"id":99,"isbn_10":"080442957X","isbn_13":"9780804429573","release_date":"2018-01-01","publisher":{"name":"Edition Publisher"},"book":` + workRow + `}`
const otherEditionRow = `{"id":100,"isbn_10":null,"isbn_13":"9780804429993","book":{"id":123,"title":"Wrong book"}}`

func TestCatalogExactISBNAndWorkResolution(t *testing.T) {
	for _, tc := range []struct{ input, isbn, field string }{
		{"978-0-8044-2957-3", "9780804429573", "isbn_13"},
		{"0 8044-2957-x", "080442957X", "isbn_10"},
	} {
		t.Run(tc.field, func(t *testing.T) {
			c := testCatalog(t, func(w http.ResponseWriter, r catalogRequest) {
				if _, ok := r.Variables["work"]; ok {
					assert.Contains(t, r.Query, "books(where: {id: {_eq: $work}}")
					assert.Equal(t, float64(42), r.Variables["work"])
					fmt.Fprint(w, `{"data":{"books":[`+workRow+`]}}`)
					return
				}
				assert.Contains(t, r.Query, "editions(where: $where")
				where, ok := r.Variables["where"].(map[string]any)
				if !assert.True(t, ok) {
					return
				}
				if len(where) == 1 {
					assert.Equal(t, map[string]any{tc.field: catalogEqual(tc.isbn)}, where)
					fmt.Fprint(w, `{"data":{"editions":[`+otherEditionRow+`,`+editionRow+`]}}`)
				} else {
					assert.Contains(t, where, "book_id")
					if len(where) == 2 {
						_, byID := where["id"]
						_, byISBN := where[tc.field]
						assert.NotEqual(t, byID, byISBN)
					} else {
						assert.Len(t, where, 3)
						assert.Contains(t, where, "id")
					}
					// The adapter must reject a wrong ID, parent or ISBN even if upstream returns a row.
					fmt.Fprint(w, `{"data":{"editions":[`+editionRow+`]}}`)
				}
			})
			matches, err := c.Lookup(t.Context(), tc.input)
			require.NoError(t, err)
			require.Len(t, matches, 1)
			m := matches[0]
			require.Equal(t, "42", m.ID)
			require.Equal(t, "99", *m.EditionID)
			require.Equal(t, "9780804429573", *m.ISBN13)
			require.Equal(t, "080442957X", *m.ISBN10)
			preview, err := c.Resolve(t.Context(), m.ID, *m.EditionID, tc.isbn)
			require.NoError(t, err)
			require.Equal(t, m, preview)
			require.Equal(t, "Edition Publisher", *preview.Publisher)
			require.Equal(t, "Work synopsis", *preview.Description)
			for _, optional := range [][2]string{{"99", ""}, {"", tc.isbn}} {
				resolved, err := c.Resolve(t.Context(), "42", optional[0], optional[1])
				require.NoError(t, err)
				require.Equal(t, preview, resolved)
			}
			for _, ids := range [][3]string{{"123", "99", tc.isbn}, {"42", "100", tc.isbn}, {"42", "99", "9780804429993"}} {
				_, err := c.Resolve(t.Context(), ids[0], ids[1], ids[2])
				require.ErrorIs(t, err, metadata.ErrInvalidLookupMatch)
			}
			work, err := c.Resolve(t.Context(), "42", "", "")
			require.NoError(t, err)
			require.Equal(t, "Verified Author", work.Author)
			require.Nil(t, work.EditionID)
			require.Nil(t, work.ISBN13)
		})
	}
}

func TestCatalogDoesNotExposeProviderErrorsOrFollowRedirects(t *testing.T) {
	for _, status := range []int{200, 401, 429, 503, 307} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Error("catalog followed a redirect")
			}))
			defer target.Close()
			c := testCatalog(t, func(w http.ResponseWriter, r catalogRequest) {
				w.Header().Set("Location", target.URL)
				w.WriteHeader(status)
				fmt.Fprintf(w, `{"data":{"search":{"results":{"hits":[]}}},"errors":[{"message":%q}]}`, testCatalogToken)
			})
			matches, err := c.Lookup(context.Background(), "Book")
			require.Nil(t, matches)
			require.ErrorIs(t, err, ErrProvider)
			require.NotContains(t, err.Error(), testCatalogToken)
		})
	}
}
