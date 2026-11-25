package api

import (
	"container/list"
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"reichard.io/antholume/matcherquota"
	"reichard.io/antholume/metadata"
)

const (
	matcherCacheSize    = 512
	matcherCacheTTL     = 10 * time.Minute
	matcherBatchTimeout = time.Minute
)

type matcherBook struct{ ID, Title, Author, ISBN string }
type matcherCandidate struct{ WorkID, Title, Author, URL, Reason string }
type matcherOutcome struct {
	DocumentID string
	Candidates []matcherCandidate
	Error      string
}

type matcherCatalog interface {
	LookupMatcherBatch(context.Context, []metadata.MatcherInput, func(string, []metadata.LookupMatch, error) error) error
	ResolveMatcher(ctx context.Context, work, edition, isbn string) (metadata.LookupMatch, error)
}

func (api *API) matcherCatalogFor(provider MetadataProvider) (matcherCatalog, error) {
	catalog, err := api.catalogFor(provider)
	if err != nil {
		return nil, err
	}
	if matcher, ok := catalog.(matcherCatalog); ok {
		return matcher, nil
	}
	return nil, adminFailure(http.StatusServiceUnavailable, "metadata_unavailable")
}

func matcherWorkURL(provider MetadataProvider, workID string) string {
	switch provider {
	case Openlibrary:
		return "https://openlibrary.org/works/" + url.PathEscape(workID)
	case Hardcover:
		return "https://hardcover.app/id/book/" + url.PathEscape(workID)
	default:
		return ""
	}
}

func (api *API) verifyMatcherLink(ctx context.Context, provider MetadataProvider, workID string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	catalog, err := api.matcherCatalogFor(provider)
	if err != nil {
		return err
	}
	match, err := catalog.ResolveMatcher(ctx, workID, "", "")
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(err, matcherquota.ErrLimited) {
		return adminFailure(http.StatusTooManyRequests, "rate_limited")
	}
	if err != nil {
		return metadataLookupFailure(err)
	}
	if match.ID != workID || workID == "" {
		return metadataLookupFailure(metadata.ErrInvalidLookupMatch)
	}
	return nil
}

type matcherKey struct {
	provider MetadataProvider
	book     metadata.MatcherInput
}

type matcherCacheEntry struct {
	key     matcherKey
	outcome matcherOutcome
	expires time.Time
}

type matcherFlight struct {
	key       matcherKey
	batch     *matcherBatch
	listeners map[chan matcherOutcome]struct{}
}

type matcherBatch struct {
	ctx       context.Context
	cancel    context.CancelFunc
	byID      map[string]*matcherFlight
	listeners int
}

type matcherEngine struct {
	mu      sync.Mutex
	flights map[matcherKey]*matcherFlight
	cache   map[matcherKey]*list.Element
	recent  list.List
}

func (api *API) runMatcherLookups(ctx context.Context, provider MetadataProvider, books []matcherBook, emit func(matcherOutcome) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(books) == 0 {
		return nil
	}
	catalog, err := api.matcherCatalogFor(provider)
	if err != nil {
		return err
	}
	inputs := make([]metadata.MatcherInput, 0, len(books))
	for _, book := range books {
		inputs = append(inputs, metadata.MatcherInput{ID: book.ID, Title: strings.TrimSpace(book.Title), Author: strings.TrimSpace(book.Author), ISBN: metadata.MatcherISBN(book.ISBN)})
	}
	if err := metadata.ValidateMatcherBatch(inputs); err != nil {
		return err
	}
	engine := &api.matcherEngine
	results := make(chan matcherOutcome, len(inputs))
	flights := engine.subscribe(provider, inputs, results, catalog)
	defer engine.unsubscribe(flights, results)
	for range inputs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case result := <-results:
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := emit(result); err != nil {
				return err
			}
		}
	}
	return nil
}

func (e *matcherEngine) subscribe(provider MetadataProvider, inputs []metadata.MatcherInput, results chan matcherOutcome, catalog matcherCatalog) []*matcherFlight {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.flights == nil {
		e.flights = make(map[matcherKey]*matcherFlight)
		e.cache = make(map[matcherKey]*list.Element)
	}
	joined := make([]*matcherFlight, 0, len(inputs))
	missing := make([]metadata.MatcherInput, 0, len(inputs))
	var batch *matcherBatch
	for _, book := range inputs {
		key := matcherKey{provider: provider, book: book}
		if entry := e.cache[key]; entry != nil {
			cached := entry.Value.(matcherCacheEntry)
			if time.Now().Before(cached.expires) {
				e.recent.MoveToFront(entry)
				results <- cloneMatcherOutcome(cached.outcome)
				continue
			}
			e.removeCacheEntry(entry)
		}
		flight := e.flights[key]
		if flight == nil {
			if batch == nil {
				// Shared Work - No one request owns a batch; the final subscriber cancels it.
				ctx, cancel := context.WithTimeout(context.Background(), matcherBatchTimeout)
				batch = &matcherBatch{ctx: ctx, cancel: cancel, byID: make(map[string]*matcherFlight)}
			}
			flight = &matcherFlight{key: key, batch: batch, listeners: make(map[chan matcherOutcome]struct{})}
			e.flights[key] = flight
			batch.byID[book.ID] = flight
			missing = append(missing, book)
		}
		flight.listeners[results] = struct{}{}
		flight.batch.listeners++
		joined = append(joined, flight)
	}
	if batch != nil {
		go e.lookup(catalog, batch, provider, missing)
	}
	return joined
}

func (e *matcherEngine) unsubscribe(flights []*matcherFlight, results chan matcherOutcome) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, flight := range flights {
		if _, exists := flight.listeners[results]; !exists {
			continue
		}
		delete(flight.listeners, results)
		flight.batch.listeners--
		e.cancelUnobserved(flight.batch)
	}
}

func (e *matcherEngine) cancelUnobserved(batch *matcherBatch) {
	if batch.listeners != 0 {
		return
	}
	batch.cancel()
	for _, flight := range batch.byID {
		delete(e.flights, flight.key)
	}
	clear(batch.byID)
}

func (e *matcherEngine) lookup(catalog matcherCatalog, batch *matcherBatch, provider MetadataProvider, books []metadata.MatcherInput) {
	defer batch.cancel()
	byID := make(map[string]metadata.MatcherInput, len(books))
	for _, book := range books {
		byID[book.ID] = book
	}
	err := catalog.LookupMatcherBatch(batch.ctx, books, func(id string, matches []metadata.LookupMatch, err error) error {
		if ctxErr := batch.ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if book, ok := byID[id]; ok {
			e.complete(batch, matcherResult(provider, book, matches, err))
		}
		return nil
	})
	// An interrupted adapter leaves pending rows, not successful empty searches.
	for _, book := range books {
		e.complete(batch, matcherOutcome{DocumentID: book.ID, Error: matcherErrorCode(err)})
	}
}

func (e *matcherEngine) complete(batch *matcherBatch, outcome matcherOutcome) {
	e.mu.Lock()
	defer e.mu.Unlock()
	flight := batch.byID[outcome.DocumentID]
	if flight == nil {
		return
	}
	delete(batch.byID, outcome.DocumentID)
	delete(e.flights, flight.key)
	if outcome.Error == "" {
		entry := matcherCacheEntry{flight.key, outcome, time.Now().Add(matcherCacheTTL)}
		e.cache[flight.key] = e.recent.PushFront(entry)
		if e.recent.Len() > matcherCacheSize {
			e.removeCacheEntry(e.recent.Back())
		}
	}
	for listener := range flight.listeners {
		// Each request reserves one channel slot per requested document.
		listener <- cloneMatcherOutcome(outcome)
	}
	batch.listeners -= len(flight.listeners)
	clear(flight.listeners)
	e.cancelUnobserved(batch)
}

func (e *matcherEngine) removeCacheEntry(entry *list.Element) {
	delete(e.cache, entry.Value.(matcherCacheEntry).key)
	e.recent.Remove(entry)
}

func cloneMatcherOutcome(outcome matcherOutcome) matcherOutcome {
	if len(outcome.Candidates) > 0 {
		outcome.Candidates = append([]matcherCandidate(nil), outcome.Candidates...)
	}
	return outcome
}

func matcherErrorCode(err error) string {
	if errors.Is(err, matcherquota.ErrLimited) {
		return "rate_limited"
	}
	return "lookup_failed"
}

func matcherResult(provider MetadataProvider, book metadata.MatcherInput, matches []metadata.LookupMatch, err error) matcherOutcome {
	result := matcherOutcome{DocumentID: book.ID}
	if err != nil {
		result.Error = matcherErrorCode(err)
		return result
	}
	isbns := metadata.MatcherISBNs(book.ISBN)
	for _, match := range matches {
		candidate := matcherCandidate{WorkID: match.ID, Title: match.Title, Author: match.Author, URL: matcherWorkURL(provider, match.ID)}
		for _, isbn := range isbns {
			if isbn == matchParam(match.ISBN10) || isbn == matchParam(match.ISBN13) {
				candidate.Reason = "ISBN match"
				break
			}
		}
		result.Candidates = append(result.Candidates, candidate)
	}
	return result
}
