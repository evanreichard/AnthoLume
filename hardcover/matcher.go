package hardcover

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"reichard.io/antholume/metadata"
)

const matcherEditions = `query AnthoLumeMatcherEditions($where: editions_bool_exp!, $limit: Int!) {
  editions(where: $where, order_by: {id: asc}, limit: $limit) {
    id isbn_10 isbn_13 image { id url } book { id title release_year image { id url } contributions(where: {contribution: {_eq: "Author"}}, limit: 8) { author { name } } }
  }
}`

func (c *Catalog) ResolveMatcher(ctx context.Context, work, edition, isbn string) (metadata.LookupMatch, error) {
	return c.Resolve(ctx, work, edition, isbn)
}

func (c *Catalog) LookupMatcherBatch(ctx context.Context, books []metadata.MatcherInput, emit func(string, []metadata.LookupMatch, error) error) error {
	if err := metadata.ValidateMatcherBatch(books); err != nil {
		return err
	}
	byISBN, isbnErr := c.matcherISBNs(ctx, books)
	fallback := make([]metadata.MatcherInput, 0, len(books))
	for _, book := range books {
		if err := ctx.Err(); err != nil {
			return err
		}
		variants := metadata.MatcherISBNs(book.ISBN)
		var candidates []metadata.LookupMatch
		for _, isbn := range variants {
			candidates = append(candidates, byISBN[isbn]...)
		}
		if len(candidates) == 0 && (len(variants) == 0 || isbnErr == nil) {
			fallback = append(fallback, book)
			continue
		}
		if err := emit(book.ID, metadata.RankMatcherResults(book, candidates), isbnErr); err != nil {
			return err
		}
	}

	for len(fallback) > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		// Search Groups - Small alias groups return progressively without using the whole burst in one request.
		size := min(3, len(fallback))
		group := fallback[:size]
		if err := c.matcherSearch(ctx, group, emit); err != nil {
			return err
		}
		fallback = fallback[size:]
	}
	return nil
}

func (c *Catalog) matcherISBNs(ctx context.Context, books []metadata.MatcherInput) (map[string][]metadata.LookupMatch, error) {
	isbns := make(map[string]bool)
	var ten, thirteen []string
	for _, book := range books {
		for _, isbn := range metadata.MatcherISBNs(book.ISBN) {
			if isbns[isbn] {
				continue
			}
			isbns[isbn] = true
			if len(isbn) == 10 {
				ten = append(ten, isbn)
			} else {
				thirteen = append(thirteen, isbn)
			}
		}
	}
	if len(isbns) == 0 {
		return nil, nil
	}
	sort.Strings(ten)
	sort.Strings(thirteen)
	where := make([]map[string]any, 0, 2)
	if len(ten) > 0 {
		where = append(where, map[string]any{"isbn_10": map[string]any{"_in": ten}})
	}
	if len(thirteen) > 0 {
		where = append(where, map[string]any{"isbn_13": map[string]any{"_in": thirteen}})
	}
	var data struct {
		Editions []catalogEdition `json:"editions"`
	}
	vars := map[string]any{"where": map[string]any{"_or": where}, "limit": metadata.MatcherBatchSize * metadata.MatcherCandidateLimit}
	if err := c.query(ctx, matcherEditions, vars, &data); err != nil {
		return nil, err
	}
	if data.Editions == nil {
		return nil, ErrProvider
	}
	matches := make(map[string][]metadata.LookupMatch, len(isbns))
	for _, edition := range data.Editions {
		if edition.ID < 1 || edition.Book.ID < 1 {
			continue
		}
		m := edition.match()
		if m.Title == "" {
			continue
		}
		for _, isbn := range []string{edition.ISBN10, edition.ISBN13} {
			if isbns[isbn] && edition.matchesISBN(isbn) {
				matches[isbn] = append(matches[isbn], m)
			}
		}
	}
	return matches, nil
}

func (c *Catalog) matcherSearch(ctx context.Context, books []metadata.MatcherInput, emit func(string, []metadata.LookupMatch, error) error) error {
	vars := make(map[string]string, len(books))
	var declarations, fields []string
	aliases := make(map[string]string, len(books))
	for _, book := range books {
		if text := book.SearchText(); text != "" {
			alias := fmt.Sprintf("book%d", len(vars))
			aliases[book.ID] = alias
			vars[alias] = text
			declarations = append(declarations, "$"+alias+": String!")
			fields = append(fields, alias+": search(query: $"+alias+catalogSearchArgs)
		}
	}
	var data map[string]json.RawMessage
	var queryErr error
	if len(vars) > 0 {
		query := "query AnthoLumeMatcherSearch(" + strings.Join(declarations, ", ") + ") {\n" + strings.Join(fields, "\n") + "\n}"
		data, queryErr = c.matcherSearchData(ctx, query, vars)
	}
	for _, book := range books {
		if err := ctx.Err(); err != nil {
			return err
		}
		var matches []metadata.LookupMatch
		var err error
		if alias := aliases[book.ID]; alias != "" {
			var search catalogSearchResult
			err = queryErr
			if err == nil {
				if json.Unmarshal(data[alias], &search) != nil {
					err = ErrProvider
				} else {
					matches, err = search.matches()
				}
			}
		}
		if err := emit(book.ID, metadata.RankMatcherResults(book, matches), err); err != nil {
			return err
		}
	}
	return nil
}

func (c *Catalog) matcherSearchData(ctx context.Context, query string, vars map[string]string) (map[string]json.RawMessage, error) {
	if !validToken(c.token) {
		return nil, ErrProvider
	}
	response, err := graphqlRequest(ctx, c.quota.Client(c.http, len(vars)), c.endpoint, c.token, query, vars)
	if err != nil {
		return nil, err
	}
	var data map[string]json.RawMessage
	if json.Unmarshal(response.Data, &data) != nil {
		return nil, ErrProvider
	}
	for _, failure := range response.Errors {
		var alias string
		if len(failure.Path) == 0 || json.Unmarshal(failure.Path[0], &alias) != nil {
			return nil, ErrProvider
		}
		if _, known := vars[alias]; !known {
			return nil, ErrProvider
		}
		delete(data, alias)
	}
	return data, nil
}
