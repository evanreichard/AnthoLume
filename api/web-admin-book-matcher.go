package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"sync"

	"reichard.io/antholume/database"
)

const matcherPageSize = 10

func matcherLink(provider MetadataProvider, workID string) *AdminBookMatcherLink {
	if workID == "" {
		return nil
	}
	return &AdminBookMatcherLink{WorkId: workID, Url: matcherWorkURL(provider, workID)}
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

func (s *webAPI) GetAdminBookMatcherPage(ctx context.Context, r GetAdminBookMatcherPageRequestObject) (GetAdminBookMatcherPageResponseObject, error) {
	page := 1
	if r.Params.Page != nil {
		page = *r.Params.Page
	}
	provider := r.Params.Provider
	out := GetAdminBookMatcherPage200JSONResponse{Page: page, Items: make([]AdminBookMatcherItem, 0, matcherPageSize)}
	err := s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		queries := s.api.db.Queries.WithTx(tx)
		total, err := queries.CountBookMatcherDocuments(ctx)
		if err != nil {
			return err
		}
		out.Total = int(total)
		rows, err := queries.ListBookMatcherDocuments(ctx, database.ListBookMatcherDocumentsParams{
			Namespace: workNamespaces[provider], PageOffset: (int64(page) - 1) * matcherPageSize,
		})
		if err != nil {
			return err
		}
		for _, row := range rows {
			out.Items = append(out.Items, AdminBookMatcherItem{
				Id: row.ID, Title: matchParam(row.Title), Author: matchParam(row.Author),
				Isbn: matcherISBN(row.Isbn13, row.Isbn10), Match: matcherLink(provider, row.WorkID),
			})
		}
		return nil
	})
	return out, err
}

func (s *webAPI) LookupAdminBookMatches(ctx context.Context, r LookupAdminBookMatchesRequestObject) (LookupAdminBookMatchesResponseObject, error) {
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
			response.ready = append(response.ready, AdminBookMatcherOutcome{DocumentId: id, Error: &code})
		case row.WorkID != "":
			response.ready = append(response.ready, AdminBookMatcherOutcome{DocumentId: id, Match: matcherLink(provider, row.WorkID)})
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
	ready    []AdminBookMatcherOutcome
	books    []matcherBook
}

func (r *matcherLookupResponse) VisitLookupAdminBookMatchesResponse(w http.ResponseWriter) error {
	controller := http.NewResponseController(w)
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	encoder := json.NewEncoder(w)
	emit := func(outcome AdminBookMatcherOutcome) error {
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
		outcome := AdminBookMatcherOutcome{DocumentId: result.DocumentID}
		if result.Error != "" {
			outcome.Error = &result.Error
		} else {
			candidates := make([]AdminBookMatcherCandidate, 0, len(result.Candidates))
			for _, candidate := range result.Candidates {
				entry := AdminBookMatcherCandidate{WorkId: candidate.WorkID, Title: candidate.Title, Author: candidate.Author, Url: candidate.URL}
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
			if e := emit(AdminBookMatcherOutcome{DocumentId: book.ID, Error: &code}); e != nil {
				return e
			}
		}
	}
	return err
}

func (s *webAPI) ConfirmAdminBookMatch(ctx context.Context, r ConfirmAdminBookMatchRequestObject) (ConfirmAdminBookMatchResponseObject, error) {
	if err := s.api.verifyMatcherLink(requestContext(ctx), r.Provider, r.Body.WorkId); err != nil {
		return nil, err
	}
	if err := s.changeBookMatcherLink(ctx, r.Id, r.Provider, r.Body.WorkId, true); err != nil {
		return nil, err
	}
	return ConfirmAdminBookMatch204Response{}, nil
}

func (s *webAPI) UnlinkAdminBookMatch(ctx context.Context, r UnlinkAdminBookMatchRequestObject) (UnlinkAdminBookMatchResponseObject, error) {
	if err := s.changeBookMatcherLink(ctx, r.Id, r.Provider, r.Params.WorkId, false); err != nil {
		return nil, err
	}
	return UnlinkAdminBookMatch204Response{}, nil
}

func (s *webAPI) changeBookMatcherLink(ctx context.Context, id string, provider MetadataProvider, workID string, confirm bool) error {
	namespace := workNamespaces[provider]
	return s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		queries := s.api.db.Queries.WithTx(tx)
		doc, err := queries.GetDocument(ctx, id)
		if errors.Is(err, sql.ErrNoRows) || err == nil && doc.Deleted {
			return adminFailure(http.StatusNotFound, "not_found")
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
				return adminFailure(http.StatusConflict, "book_match_changed")
			}
		}
		if confirm {
			return queries.LinkDocumentIdentifier(ctx, database.LinkDocumentIdentifierParams{DocumentID: id, Namespace: namespace, Value: workID})
		}
		return queries.UnlinkBookMatcherDocument(ctx, database.UnlinkBookMatcherDocumentParams{DocumentID: id, Namespace: namespace, WorkID: workID})
	})
}
