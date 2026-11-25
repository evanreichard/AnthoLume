package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"sync"

	"reichard.io/antholume/database"
	"reichard.io/antholume/reading"
)

func matcherLink(provider MetadataProvider, workID string) *BookMatcherLink {
	if workID == "" {
		return nil
	}
	return &BookMatcherLink{WorkId: workID, Url: matcherWorkURL(provider, workID)}
}

func matcherISBN(isbn13, isbn10 *string) *string {
	if matchParam(isbn13) != "" {
		return isbn13
	}
	if matchParam(isbn10) != "" {
		return isbn10
	}
	return nil
}

func (s *webAPI) LookupBookMatches(ctx context.Context, r LookupBookMatchesRequestObject) (LookupBookMatchesResponseObject, error) {
	ctx = requestContext(ctx)
	provider := r.Body.Provider
	if _, err := s.api.catalogFor(provider); err != nil {
		return nil, err
	}
	ids := r.Body.DocumentIds
	rows, err := s.api.db.Queries.GetBookMatcherDocuments(ctx, database.GetBookMatcherDocumentsParams{
		Namespace: workNamespaces[provider], DocumentIds: ids,
	})
	if err != nil {
		return nil, err
	}
	byID := make(map[string]database.GetBookMatcherDocumentsRow, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}
	response := &matcherLookupResponse{api: s.api, ctx: ctx, provider: provider}
	for _, id := range ids {
		row, ok := byID[id]
		switch {
		case !ok:
			code := "not_found"
			response.ready = append(response.ready, BookMatcherOutcome{DocumentId: id, Error: &code})
		case row.WorkID != "":
			response.ready = append(response.ready, BookMatcherOutcome{DocumentId: id, Match: matcherLink(provider, row.WorkID)})
		default:
			response.books = append(response.books, matcherBook{
				ID: id, Title: matchParam(row.Title), Author: matchParam(row.Author), ISBN: matchParam(matcherISBN(row.Isbn13, row.Isbn10)),
			})
		}
	}
	return response, nil
}

type matcherLookupResponse struct {
	api      *API
	ctx      context.Context
	provider MetadataProvider
	ready    []BookMatcherOutcome
	books    []matcherBook
}

func (r *matcherLookupResponse) VisitLookupBookMatchesResponse(w http.ResponseWriter) error {
	controller := http.NewResponseController(w)
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	encoder := json.NewEncoder(w)
	emit := func(outcome BookMatcherOutcome) error {
		if err := r.ctx.Err(); err != nil {
			return err
		}
		if err := encoder.Encode(outcome); err != nil {
			return err
		}
		return controller.Flush()
	}
	for _, row := range r.ready {
		if err := emit(row); err != nil {
			return err
		}
	}
	if len(r.books) == 0 {
		return nil
	}

	pending := make(map[string]bool, len(r.books))
	for _, book := range r.books {
		pending[book.ID] = true
	}
	var mu sync.Mutex
	var writeErr error
	err := r.api.runMatcherLookups(r.ctx, r.provider, r.books, func(result matcherOutcome) error {
		mu.Lock()
		defer mu.Unlock()
		if writeErr != nil || !pending[result.DocumentID] {
			return writeErr
		}
		outcome := BookMatcherOutcome{DocumentId: result.DocumentID}
		if result.Error != "" {
			outcome.Error = &result.Error
		} else {
			candidates := make([]BookMatcherCandidate, 0, len(result.Candidates))
			for _, candidate := range result.Candidates {
				entry := BookMatcherCandidate{WorkId: candidate.WorkID, Title: candidate.Title, Author: candidate.Author, Url: candidate.URL}
				if candidate.Reason != "" {
					entry.Reason = &candidate.Reason
				}
				candidates = append(candidates, entry)
			}
			outcome.Candidates = &candidates
		}
		delete(pending, result.DocumentID)
		writeErr = emit(outcome)
		return writeErr
	})
	if writeErr != nil {
		return writeErr
	}
	if r.ctx.Err() != nil {
		return r.ctx.Err()
	}
	for _, book := range r.books {
		if pending[book.ID] {
			code := "lookup_failed"
			if e := emit(BookMatcherOutcome{DocumentId: book.ID, Error: &code}); e != nil {
				return e
			}
		}
	}
	return err
}

func (s *webAPI) ConfirmBookMatch(ctx context.Context, r ConfirmBookMatchRequestObject) (ConfirmBookMatchResponseObject, error) {
	if err := s.api.verifyMatcherLink(requestContext(ctx), r.Provider, r.Body.WorkId); err != nil {
		return nil, err
	}
	if err := s.changeBookMatcherLink(ctx, r.Id, r.Provider, r.Body.WorkId, true); err != nil {
		return nil, err
	}
	return ConfirmBookMatch204Response{}, nil
}

func (s *webAPI) UnlinkBookMatch(ctx context.Context, r UnlinkBookMatchRequestObject) (UnlinkBookMatchResponseObject, error) {
	if err := s.changeBookMatcherLink(ctx, r.Id, r.Provider, r.Params.WorkId, false); err != nil {
		return nil, err
	}
	return UnlinkBookMatch204Response{}, nil
}

func (s *webAPI) changeBookMatcherLink(ctx context.Context, id string, provider MetadataProvider, workID string, confirm bool) error {
	namespace := workNamespaces[provider]
	ctx = requestContext(ctx)
	tx, err := s.api.db.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	queries := s.api.db.Queries.WithTx(tx)
	doc, err := queries.GetDocument(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || err == nil && doc.Deleted {
		return &reading.Failure{Status: http.StatusNotFound, Code: "not_found"}
	}
	if err != nil {
		return err
	}
	links, err := queries.ListDocumentIdentifiers(ctx, id)
	if err != nil {
		return err
	}
	for _, link := range links {
		if link.Namespace == namespace && link.Value != workID {
			return &reading.Failure{Status: http.StatusConflict, Code: "book_match_changed"}
		}
	}
	if confirm {
		err = queries.LinkDocumentIdentifier(ctx, database.LinkDocumentIdentifierParams{DocumentID: id, Namespace: namespace, Value: workID})
	} else {
		err = queries.UnlinkBookMatcherDocument(ctx, database.UnlinkBookMatcherDocumentParams{DocumentID: id, Namespace: namespace, WorkID: workID})
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}
