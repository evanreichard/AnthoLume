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

func collectMatcherResults(t *testing.T, api *API, provider MetadataProvider, books ...matcherBook) []matcherOutcome {
	t.Helper()
	var results []matcherOutcome
	require.NoError(t, api.runMatcherLookups(t.Context(), provider, books, func(row matcherOutcome) error {
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
					isbn := "9780547773742"
					matches = []metadata.LookupMatch{{ID: "OL1W", Title: "First", ISBN13: &isbn}, {ID: "OL2W", Title: "Second"}}
				}
				if err := emit(book.ID, matches, nil); err != nil {
					return err
				}
			}
			return nil
		}}
		api := &API{openLibraryCatalog: catalog, hardcoverCatalog: catalog}
		book := matcherBook{ID: "earthsea", Title: " Earthsea ", Author: "Le Guin", ISBN: "978-0547773742"}
		missing := matcherBook{ID: "other", Title: "No match"}
		results := collectMatcherResults(t, api, Openlibrary, book, missing)
		input := <-batches
		require.Len(t, input, 2)
		require.Equal(t, metadata.MatcherInput{ID: "earthsea", Title: "Earthsea", Author: "Le Guin", ISBN: "9780547773742"}, input[0])
		require.Equal(t, []matcherCandidate{
			{WorkID: "OL1W", Title: "First", URL: "https://openlibrary.org/works/OL1W", Reason: "ISBN match"},
			{WorkID: "OL2W", Title: "Second", URL: "https://openlibrary.org/works/OL2W"},
		}, results[0].Candidates)
		require.Empty(t, results[1].Candidates)
		require.Empty(t, results[1].Error)
		results[0].Candidates[0].Title = "Modified by subscriber"

		book.Title, book.ISBN = "Earthsea", "9780547773742"
		cached := collectMatcherResults(t, api, Openlibrary, book, missing)
		require.Empty(t, batches)
		require.Equal(t, "First", cached[0].Candidates[0].Title)
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
		var books []matcherBook
		for id := start; id < min(matcherCacheSize, start+metadata.MatcherBatchSize); id++ {
			books = append(books, matcherBook{ID: fmt.Sprint(id)})
		}
		collectMatcherResults(t, api, Openlibrary, books...)
	}
	collectMatcherResults(t, api, Openlibrary, matcherBook{ID: "0"})
	collectMatcherResults(t, api, Openlibrary, matcherBook{ID: "extra"})
	before := calls
	collectMatcherResults(t, api, Openlibrary, matcherBook{ID: "0"})
	require.Equal(t, before, calls)
	collectMatcherResults(t, api, Openlibrary, matcherBook{ID: "1"})
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
		listen := func(books ...matcherBook) (context.CancelFunc, <-chan matcherOutcome, <-chan error) {
			ctx, cancel := context.WithCancel(t.Context())
			rows, done := make(chan matcherOutcome, len(books)), make(chan error, 1)
			go func() {
				done <- api.runMatcherLookups(ctx, Openlibrary, books, func(row matcherOutcome) error {
					rows <- row
					return nil
				})
			}()
			return cancel, rows, done
		}
		shared := matcherBook{ID: "shared"}
		cancelLeader, _, leaderDone := listen(shared)
		first := <-started
		cancelFollower, rows, followerDone := listen(shared, matcherBook{ID: "other"})
		defer cancelFollower()
		require.Equal(t, []metadata.MatcherInput{{ID: "other"}}, (<-started).books)
		require.Equal(t, "other", (<-rows).DocumentID)
		cancelLeader()
		require.ErrorIs(t, <-leaderDone, context.Canceled)
		require.NoError(t, first.ctx.Err())
		close(release)
		require.Equal(t, "shared", (<-rows).DocumentID)
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
		slow := matcherBook{ID: "slow"}
		err := api.runMatcherLookups(t.Context(), Openlibrary, []matcherBook{{ID: "fast"}, slow}, func(matcherOutcome) error { return writeErr })
		require.ErrorIs(t, err, writeErr)
		require.ErrorIs(t, <-stopped, context.Canceled)
		require.Equal(t, []matcherOutcome{{DocumentID: "slow"}}, collectMatcherResults(t, api, Openlibrary, slow))
	})
}

func TestMatcherEngineReportsUnfinishedAndLimitedRowsWithoutCachingErrors(t *testing.T) {
	catalog := matcherEngineCatalog{lookup: func(_ context.Context, books []metadata.MatcherInput, emit func(string, []metadata.LookupMatch, error) error) error {
		if len(books) > 1 {
			if err := emit(books[0].ID, nil, matcherquota.ErrLimited); err != nil {
				return err
			}
			return errors.New("private provider error")
		}
		return emit(books[0].ID, nil, nil)
	}}
	api := &API{openLibraryCatalog: catalog}
	limited := matcherBook{ID: "limited"}
	unfinished := matcherBook{ID: "unfinished"}
	require.Equal(t, []matcherOutcome{{DocumentID: "limited", Error: "rate_limited"}, {DocumentID: "unfinished", Error: "lookup_failed"}}, collectMatcherResults(t, api, Openlibrary, limited, unfinished))
	require.Equal(t, []matcherOutcome{{DocumentID: "limited"}}, collectMatcherResults(t, api, Openlibrary, limited))
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
