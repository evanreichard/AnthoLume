package api

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/matcherquota"
	"reichard.io/antholume/metadata"
)

type matcherEngineCatalog struct {
	lookup  func(context.Context, []metadata.MatcherInput, func(string, []metadata.LookupMatch, error) error) error
	resolve func(context.Context, string, string, string) (metadata.LookupMatch, error)
}

func (matcherEngineCatalog) Lookup(context.Context, string) ([]metadata.LookupMatch, error) {
	return nil, errors.New("matcher must use the batch adapter")
}

func (matcherEngineCatalog) Resolve(context.Context, string, string, string) (metadata.LookupMatch, error) {
	return metadata.LookupMatch{}, errors.New("matcher must use the paced resolver")
}

func (matcherEngineCatalog) Cover(context.Context, int64) ([]byte, error) {
	return nil, errors.New("matcher does not fetch covers")
}

func (c matcherEngineCatalog) LookupMatcherBatch(ctx context.Context, books []metadata.MatcherInput, emit func(string, []metadata.LookupMatch, error) error) error {
	return c.lookup(ctx, books, emit)
}

func (c matcherEngineCatalog) ResolveMatcher(ctx context.Context, work, edition, isbn string) (metadata.LookupMatch, error) {
	return c.resolve(ctx, work, edition, isbn)
}

func collectMatcherResults(t *testing.T, api *API, provider MetadataProvider, books ...metadata.MatcherInput) []BookMatcherOutcome {
	t.Helper()
	var results []BookMatcherOutcome
	require.NoError(t, api.runMatcherLookups(t.Context(), provider, books, func(row BookMatcherOutcome) error {
		results = append(results, row)
		return nil
	}))
	return results
}

func TestMatcherEngineCacheScopeAndExpiry(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		batches := make(chan []metadata.MatcherInput, 10)
		catalog := matcherEngineCatalog{lookup: func(_ context.Context, books []metadata.MatcherInput, emit func(string, []metadata.LookupMatch, error) error) error {
			batches <- books
			for _, book := range books {
				var matches []metadata.LookupMatch
				if book.Title != "No match" {
					isbn10, isbn13, edition := "0547773749", "9780547773742", "OL11M"
					matches = []metadata.LookupMatch{{ID: "OL1W", Title: "First", ISBN10: &isbn10, EditionID: &edition}, {ID: "OL2W", Title: "Second", ISBN13: &isbn13}}
				}
				if err := emit(book.ID, matches, nil); err != nil {
					return err
				}
			}
			return nil
		}}
		api := &API{openLibraryCatalog: catalog, hardcoverCatalog: catalog}
		book := metadata.MatcherInput{ID: "earthsea", Title: " Earthsea ", Author: "Le Guin", ISBN: "978-0547773742"}
		missing := metadata.MatcherInput{ID: "other", Title: "No match"}
		results := collectMatcherResults(t, api, Openlibrary, book, missing)
		book.Title, book.ISBN = "Earthsea", "9780547773742"
		require.Equal(t, []metadata.MatcherInput{book, missing}, <-batches)
		want := []BookMatcherOutcome{
			{DocumentId: book.ID, Candidates: &[]BookMatcherCandidate{
				{WorkId: "OL1W", Title: "First", Url: "https://openlibrary.org/works/OL1W", Reason: new("ISBN match"), EditionId: new("OL11M"), Isbn: new("0547773749")},
				{WorkId: "OL2W", Title: "Second", Url: "https://openlibrary.org/works/OL2W", Reason: new("ISBN match")},
			}},
			{DocumentId: missing.ID, Candidates: &[]BookMatcherCandidate{}},
		}
		require.Equal(t, want, results)
		modified := &(*results[0].Candidates)[0]
		modified.Title, *modified.Reason, *modified.EditionId, *modified.Isbn = "modified", "modified", "modified", "modified"
		*results[1].Candidates = append(*results[1].Candidates, BookMatcherCandidate{WorkId: "injected"})

		require.Equal(t, want, collectMatcherResults(t, api, Openlibrary, book, missing))
		require.Empty(t, batches)
		collectMatcherResults(t, api, Hardcover, book)
		require.Len(t, <-batches, 1)
		book.Author = "A different author"
		collectMatcherResults(t, api, Openlibrary, book)
		require.Equal(t, book.Author, (<-batches)[0].Author)
		book.ISBN = ""
		collectMatcherResults(t, api, Openlibrary, book)
		require.Empty(t, (<-batches)[0].ISBN)
		time.Sleep(matcherCacheTTL)
		collectMatcherResults(t, api, Openlibrary, book)
		require.Len(t, <-batches, 1)
	})
}

func TestMatcherEngineCacheCapacity(t *testing.T) {
	calls := 0
	catalog := matcherEngineCatalog{lookup: func(_ context.Context, books []metadata.MatcherInput, emit func(string, []metadata.LookupMatch, error) error) error {
		calls++
		for _, book := range books {
			if err := emit(book.ID, nil, nil); err != nil {
				return err
			}
		}
		return nil
	}}
	api := &API{openLibraryCatalog: catalog}
	for start := 0; start < matcherCacheSize; start += metadata.MatcherBatchSize {
		var books []metadata.MatcherInput
		for id := start; id < min(matcherCacheSize, start+metadata.MatcherBatchSize); id++ {
			books = append(books, metadata.MatcherInput{ID: fmt.Sprint(id)})
		}
		collectMatcherResults(t, api, Openlibrary, books...)
	}
	first := metadata.MatcherInput{ID: "0"}
	collectMatcherResults(t, api, Openlibrary, first)
	collectMatcherResults(t, api, Openlibrary, metadata.MatcherInput{ID: "extra"})
	before := calls
	collectMatcherResults(t, api, Openlibrary, first)
	require.Equal(t, before, calls)
	collectMatcherResults(t, api, Openlibrary, metadata.MatcherInput{ID: "1"})
	require.Equal(t, before+1, calls)
}

func TestMatcherEngineSharesOverlappingRequestsAndCancelsUnusedWork(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		type start struct {
			ctx   context.Context
			books []metadata.MatcherInput
		}
		started := make(chan start, 3)
		release := make(chan struct{})
		catalog := matcherEngineCatalog{lookup: func(ctx context.Context, books []metadata.MatcherInput, emit func(string, []metadata.LookupMatch, error) error) error {
			started <- start{ctx, books}
			if books[0].ID != "other" {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-release:
				}
			}
			for _, book := range books {
				if err := emit(book.ID, nil, nil); err != nil {
					return err
				}
			}
			return nil
		}}
		api := &API{openLibraryCatalog: catalog}
		listen := func(books ...metadata.MatcherInput) (context.CancelFunc, <-chan BookMatcherOutcome, <-chan error) {
			ctx, cancel := context.WithCancel(t.Context())
			rows, done := make(chan BookMatcherOutcome, len(books)), make(chan error, 1)
			go func() {
				done <- api.runMatcherLookups(ctx, Openlibrary, books, func(row BookMatcherOutcome) error {
					rows <- row
					return nil
				})
			}()
			return cancel, rows, done
		}
		shared, other := metadata.MatcherInput{ID: "shared"}, metadata.MatcherInput{ID: "other"}
		cancelLeader, _, leaderDone := listen(shared)
		first := <-started
		cancelFollower, rows, followerDone := listen(shared, other)
		defer cancelFollower()
		require.Equal(t, []metadata.MatcherInput{other}, (<-started).books)
		require.Equal(t, other.ID, (<-rows).DocumentId)
		cancelLeader()
		require.ErrorIs(t, <-leaderDone, context.Canceled)
		require.NoError(t, first.ctx.Err())
		close(release)
		require.Equal(t, shared.ID, (<-rows).DocumentId)
		require.NoError(t, <-followerDone)
		require.Empty(t, started)
	})
}

func TestMatcherEngineWriteFailureAbandonsPendingBatch(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		stopped := make(chan error, 1)
		catalog := matcherEngineCatalog{lookup: func(ctx context.Context, books []metadata.MatcherInput, emit func(string, []metadata.LookupMatch, error) error) error {
			if len(books) == 1 {
				return emit(books[0].ID, nil, nil)
			}
			if err := emit(books[0].ID, nil, nil); err != nil {
				return err
			}
			<-ctx.Done()
			stopped <- ctx.Err()
			return ctx.Err()
		}}
		api := &API{openLibraryCatalog: catalog}
		writeErr := errors.New("stream closed")
		slow := metadata.MatcherInput{ID: "slow"}
		err := api.runMatcherLookups(t.Context(), Openlibrary, []metadata.MatcherInput{{ID: "fast"}, slow}, func(BookMatcherOutcome) error { return writeErr })
		require.ErrorIs(t, err, writeErr)
		require.ErrorIs(t, <-stopped, context.Canceled)
		require.Equal(t, []BookMatcherOutcome{{DocumentId: slow.ID, Candidates: &[]BookMatcherCandidate{}}}, collectMatcherResults(t, api, Openlibrary, slow))
	})
}

func TestMatcherEngineReportsUnfinishedAndLimitedRowsWithoutCachingErrors(t *testing.T) {
	catalog := matcherEngineCatalog{lookup: func(_ context.Context, books []metadata.MatcherInput, emit func(string, []metadata.LookupMatch, error) error) error {
		if len(books) > 1 {
			if err := emit(books[0].ID, nil, matcherquota.ErrLimited); err != nil {
				return err
			}
			if err := emit(books[0].ID, nil, nil); err != nil {
				return err
			}
			return errors.New("private provider error")
		}
		return emit(books[0].ID, nil, nil)
	}}
	api := &API{openLibraryCatalog: catalog}
	limited, unfinished := metadata.MatcherInput{ID: "limited"}, metadata.MatcherInput{ID: "unfinished"}
	require.Equal(t, []BookMatcherOutcome{{DocumentId: limited.ID, Error: new("rate_limited")}, {DocumentId: unfinished.ID, Error: new("lookup_failed")}}, collectMatcherResults(t, api, Openlibrary, limited, unfinished))
	require.Equal(t, []BookMatcherOutcome{{DocumentId: limited.ID, Candidates: &[]BookMatcherCandidate{}}}, collectMatcherResults(t, api, Openlibrary, limited))
	require.Equal(t, []BookMatcherOutcome{{DocumentId: limited.ID, Error: new("metadata_unavailable")}, {DocumentId: unfinished.ID, Error: new("metadata_unavailable")}}, collectMatcherResults(t, api, Hardcover, limited, unfinished))
}

func TestMatcherEngineVerifiesThroughSelectedPacedCatalog(t *testing.T) {
	catalog := matcherEngineCatalog{resolve: func(_ context.Context, work, edition, isbn string) (metadata.LookupMatch, error) {
		require.Empty(t, edition)
		require.Empty(t, isbn)
		switch work {
		case "42":
			return metadata.LookupMatch{ID: work}, nil
		case "43":
			return metadata.LookupMatch{ID: "42"}, nil
		default:
			return metadata.LookupMatch{}, matcherquota.ErrLimited
		}
	}}
	api := &API{hardcoverCatalog: catalog}
	require.NoError(t, api.verifyMatcherLink(t.Context(), Hardcover, "42"))
	require.Equal(t, "https://hardcover.app/id/book/42", matcherWorkURL(Hardcover, "42"))
	require.ErrorContains(t, api.verifyMatcherLink(t.Context(), Hardcover, "43"), "invalid_request")
	require.ErrorContains(t, api.verifyMatcherLink(t.Context(), Hardcover, "44"), "rate_limited")
	require.ErrorContains(t, api.verifyMatcherLink(t.Context(), Openlibrary, "OL1W"), "metadata_unavailable")
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	require.ErrorIs(t, api.verifyMatcherLink(ctx, Hardcover, "42"), context.Canceled)
}
