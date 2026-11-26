package api

import (
	"container/list"
	"context"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"reichard.io/antholume/matcherquota"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/reading"
)

const (
	matcherCacheSize    = 512
	matcherCacheTTL     = 10 * time.Minute
	matcherBatchTimeout = time.Minute
)

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
	return nil, &reading.Failure{Status: http.StatusServiceUnavailable, Code: "metadata_unavailable"}
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

func (api *API) resolveMatcherLink(ctx context.Context, provider MetadataProvider, workID, edition, isbn string, linkOnly bool) (metadata.LookupMatch, error) {
	if err := ctx.Err(); err != nil {
		return metadata.LookupMatch{}, err
	}
	if isbn != "" && !metadata.ValidMatcherISBN(isbn) {
		return metadata.LookupMatch{}, metadataLookupFailure(metadata.ErrInvalidLookupMatch)
	}
	catalog, err := api.matcherCatalogFor(provider)
	if err != nil {
		return metadata.LookupMatch{}, err
	}
	var match metadata.LookupMatch
	if verifier, ok := catalog.(interface {
		VerifyMatcherWork(context.Context, string) error
	}); linkOnly && ok {
		err = verifier.VerifyMatcherWork(ctx, workID)
		match.ID = workID
	} else {
		match, err = catalog.ResolveMatcher(ctx, workID, edition, isbn)
	}
	if ctx.Err() != nil {
		return metadata.LookupMatch{}, ctx.Err()
	}
	if errors.Is(err, matcherquota.ErrLimited) {
		return metadata.LookupMatch{}, &reading.Failure{Status: http.StatusTooManyRequests, Code: "rate_limited"}
	}
	if err != nil {
		return metadata.LookupMatch{}, metadataLookupFailure(err)
	}
	resolvedEdition := matchParam(match.EditionID)
	if match.ID != workID || workID == "" ||
		edition != "" && resolvedEdition != edition ||
		isbn != "" && (resolvedEdition == "" || isbn != matchParam(match.ISBN10) && isbn != matchParam(match.ISBN13)) {
		return metadata.LookupMatch{}, metadataLookupFailure(metadata.ErrInvalidLookupMatch)
	}
	if edition == "" && isbn == "" {
		match.ISBN10, match.ISBN13 = nil, nil
		if resolvedEdition != "" {
			match.CoverID, match.CoverURL = nil, ""
		}
	}
	return match, nil
}

type matcherKey struct {
	provider MetadataProvider
	book     metadata.MatcherInput
}

type matcherCacheEntry struct {
	key     matcherKey
	outcome BookMatcherOutcome
	expires time.Time
}

type matcherFlight struct {
	key       matcherKey
	batch     *matcherBatch
	listeners map[chan BookMatcherOutcome]struct{}
}

type matcherBatch struct {
	ctx    context.Context
	cancel context.CancelFunc
	byID   map[string]*matcherFlight
}

type matcherEngine struct {
	mu      sync.Mutex
	flights map[matcherKey]*matcherFlight
	cache   map[matcherKey]*list.Element
	recent  list.List
}

func (api *API) runMatcherLookups(ctx context.Context, provider MetadataProvider, books []metadata.MatcherInput, emit func(BookMatcherOutcome) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(books) == 0 {
		return nil
	}
	inputs := slices.Clone(books)
	for i, book := range inputs {
		inputs[i].Title = strings.TrimSpace(book.Title)
		inputs[i].Author = strings.TrimSpace(book.Author)
		inputs[i].ISBN = metadata.MatcherISBN(book.ISBN)
	}
	if err := metadata.ValidateMatcherBatch(inputs); err != nil {
		return err
	}
	catalog, err := api.matcherCatalogFor(provider)
	if err != nil {
		for _, book := range inputs {
			if err := ctx.Err(); err != nil {
				return err
			}
			if err := emit(BookMatcherOutcome{DocumentId: book.ID, Error: new("metadata_unavailable")}); err != nil {
				return err
			}
		}
		return nil
	}
	engine := &api.matcherEngine
	results := make(chan BookMatcherOutcome, len(inputs))
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
			// Copy on Delivery - Cached and in-flight outcomes share immutable data; callbacks own their copy.
			if err := emit(cloneMatcherOutcome(result)); err != nil {
				return err
			}
		}
	}
	return nil
}

func (e *matcherEngine) subscribe(provider MetadataProvider, inputs []metadata.MatcherInput, results chan BookMatcherOutcome, catalog matcherCatalog) []*matcherFlight {
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
				results <- cached.outcome
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
			flight = &matcherFlight{key: key, batch: batch, listeners: make(map[chan BookMatcherOutcome]struct{})}
			e.flights[key] = flight
			batch.byID[book.ID] = flight
			missing = append(missing, book)
		}
		flight.listeners[results] = struct{}{}
		joined = append(joined, flight)
	}
	if batch != nil {
		go e.lookup(catalog, batch, missing)
	}
	return joined
}

func (e *matcherEngine) unsubscribe(flights []*matcherFlight, results chan BookMatcherOutcome) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, flight := range flights {
		if _, exists := flight.listeners[results]; !exists {
			continue
		}
		delete(flight.listeners, results)
		e.cancelUnobserved(flight.batch)
	}
}

func (e *matcherEngine) cancelUnobserved(batch *matcherBatch) {
	for _, flight := range batch.byID {
		if len(flight.listeners) > 0 {
			return
		}
	}
	batch.cancel()
	for _, flight := range batch.byID {
		delete(e.flights, flight.key)
	}
	clear(batch.byID)
}

func (e *matcherEngine) lookup(catalog matcherCatalog, batch *matcherBatch, books []metadata.MatcherInput) {
	defer batch.cancel()
	err := catalog.LookupMatcherBatch(batch.ctx, books, func(id string, matches []metadata.LookupMatch, err error) error {
		if ctxErr := batch.ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		var code string
		if err != nil {
			code = matcherErrorCode(err)
		}
		e.complete(batch, id, matches, code)
		return nil
	})
	// Unfinished Lookups - Missing adapter results are failures, not empty candidate lists.
	for _, book := range books {
		e.complete(batch, book.ID, nil, matcherErrorCode(err))
	}
}

func (e *matcherEngine) complete(batch *matcherBatch, id string, matches []metadata.LookupMatch, code string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	flight := batch.byID[id]
	if flight == nil {
		return
	}
	delete(batch.byID, id)
	delete(e.flights, flight.key)
	outcome := BookMatcherOutcome{DocumentId: id}
	if code != "" {
		outcome.Error = &code
	} else {
		candidates := matcherCandidates(flight.key, matches)
		outcome.Candidates = &candidates
		entry := matcherCacheEntry{flight.key, outcome, time.Now().Add(matcherCacheTTL)}
		e.cache[flight.key] = e.recent.PushFront(entry)
		if e.recent.Len() > matcherCacheSize {
			e.removeCacheEntry(e.recent.Back())
		}
	}
	for listener := range flight.listeners {
		// Each request reserves one channel slot per requested document.
		listener <- outcome
	}
	clear(flight.listeners)
	e.cancelUnobserved(batch)
}

func (e *matcherEngine) removeCacheEntry(entry *list.Element) {
	delete(e.cache, entry.Value.(matcherCacheEntry).key)
	e.recent.Remove(entry)
}

func cloneMatcherOutcome(outcome BookMatcherOutcome) BookMatcherOutcome {
	outcome.Error = cloneMatcherPointer(outcome.Error)
	outcome.Match = cloneMatcherPointer(outcome.Match)
	if outcome.Candidates != nil {
		candidates := slices.Clone(*outcome.Candidates)
		for i, candidate := range candidates {
			candidates[i].Reason = cloneMatcherPointer(candidate.Reason)
			candidates[i].EditionId = cloneMatcherPointer(candidate.EditionId)
			candidates[i].Isbn = cloneMatcherPointer(candidate.Isbn)
		}
		outcome.Candidates = &candidates
	}
	return outcome
}

func cloneMatcherPointer[T any](value *T) *T {
	if value == nil {
		return nil
	}
	return new(*value)
}

func matcherErrorCode(err error) string {
	if errors.Is(err, matcherquota.ErrLimited) {
		return "rate_limited"
	}
	return "lookup_failed"
}

func matcherCandidates(key matcherKey, matches []metadata.LookupMatch) []BookMatcherCandidate {
	candidates := make([]BookMatcherCandidate, 0, len(matches))
	isbns := metadata.MatcherISBNs(key.book.ISBN)
	for _, match := range matches {
		candidate := BookMatcherCandidate{WorkId: match.ID, Title: match.Title, Author: match.Author, Url: matcherWorkURL(key.provider, match.ID)}
		for _, isbn := range isbns {
			if isbn == matchParam(match.ISBN10) || isbn == matchParam(match.ISBN13) {
				candidate.Reason = new("ISBN match")
				if edition := matchParam(match.EditionID); edition != "" && metadata.ValidMatcherISBN(isbn) {
					candidate.EditionId, candidate.Isbn = &edition, new(isbn)
				}
				break
			}
		}
		candidates = append(candidates, candidate)
	}
	return candidates
}
