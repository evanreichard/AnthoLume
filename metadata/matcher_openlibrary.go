package metadata

import (
	"context"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"reichard.io/antholume/matcherquota"
)

var openLibraryMatcherQuota = matcherquota.New(time.Second)

func (OpenLibraryCatalog) LookupMatcherBatch(ctx context.Context, books []MatcherInput, emit func(string, []LookupMatch, error) error) error {
	return lookupOpenLibraryMatcher(ctx, openLibraryMatcherQuota.Client(lookupClient, 1), openLibraryBase+"/search.json", books, emit)
}

func lookupOpenLibraryMatcher(ctx context.Context, client matcherquota.Doer, endpoint string, books []MatcherInput, emit func(string, []LookupMatch, error) error) error {
	if err := ValidateMatcherBatch(books); err != nil {
		return err
	}
	isbns := make(map[string]bool)
	for _, book := range books {
		for _, isbn := range MatcherISBNs(book.ISBN) {
			isbns[isbn] = true
		}
	}
	matches := make(map[string][]LookupMatch, len(isbns))
	var isbnErr error
	if len(isbns) > 0 {
		clauses := make([]string, 0, len(isbns))
		for isbn := range isbns {
			clauses = append(clauses, "isbn:"+isbn)
		}
		sort.Strings(clauses)
		params := url.Values{
			"q": {"(" + strings.Join(clauses, " OR ") + ")"}, "limit": {strconv.Itoa(MatcherBatchSize * MatcherCandidateLimit)},
			"fields": {openLibrarySearchFields + ",isbn"},
		}
		var docs []openLibrarySearchDoc
		docs, isbnErr = searchOpenLibrary(ctx, client, endpoint, params)
		for _, doc := range docs {
			m := doc.match()
			if m.ID == "" {
				continue
			}
			// Work-Level Evidence - The work's ISBN list does not identify its cover edition.
			m.EditionID = nil
			for _, raw := range doc.ISBN {
				isbn := MatcherISBN(raw)
				if !isbns[isbn] {
					continue
				}
				candidate := m
				if len(isbn) == 10 {
					candidate.ISBN10 = &isbn
				} else {
					candidate.ISBN13 = &isbn
				}
				matches[isbn] = append(matches[isbn], candidate)
			}
		}
	}
	editions := make(map[string]openLibraryEdition)
	base := strings.TrimSuffix(endpoint, "/search.json")
	fallback := make([]MatcherInput, 0, len(books))
	for _, book := range books {
		if err := ctx.Err(); err != nil {
			return err
		}
		variants := MatcherISBNs(book.ISBN)
		var candidates []LookupMatch
		var verified []LookupMatch
		for _, isbn := range variants {
			hits := matches[isbn]
			if len(hits) == 0 {
				continue
			}
			ed, cached := editions[isbn]
			if !cached && ValidMatcherISBN(isbn) {
				// Edition Evidence - An ISBN in a search hit only establishes a work-level association.
				if record, err := readOpenLibraryEdition(ctx, client, base, "", isbn); err == nil {
					ed = record
				}
				editions[isbn] = ed
			}
			for _, candidate := range hits {
				if ed.ID != "" && ed.supports(candidate.ID, isbn) {
					candidate.EditionID = &ed.ID
					verified = append(verified, candidate)
				} else {
					candidates = append(candidates, candidate)
				}
			}
		}
		candidates = append(verified, candidates...)
		if len(candidates) == 0 && (len(variants) == 0 || isbnErr == nil) {
			fallback = append(fallback, book)
			continue
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := emit(book.ID, RankMatcherResults(book, candidates), isbnErr); err != nil {
			return err
		}
	}
	for _, book := range fallback {
		var matches []LookupMatch
		var searchErr error
		if query := book.SearchText(); query != "" {
			matches, searchErr = lookupOpenLibrary(ctx, client, endpoint, query)
			for i := range matches {
				matches[i].EditionID = nil
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := emit(book.ID, RankMatcherResults(book, matches), searchErr); err != nil {
			return err
		}
	}
	return nil
}
