package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"

	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/reading"
)

func (s *webAPI) LookupBookMatches(ctx context.Context, r LookupBookMatchesRequestObject) (LookupBookMatchesResponseObject, error) {
	ctx = requestContext(ctx)
	provider := r.Body.Provider
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
			response.ready = append(response.ready, BookMatcherOutcome{DocumentId: id, Error: new("not_found")})
		case row.WorkID != "":
			link := &BookMatcherLink{WorkId: row.WorkID, Url: matcherWorkURL(provider, row.WorkID)}
			response.ready = append(response.ready, BookMatcherOutcome{DocumentId: id, Match: link})
		default:
			isbn := matchParam(row.Isbn13)
			if isbn == "" {
				isbn = matchParam(row.Isbn10)
			}
			response.books = append(response.books, metadata.MatcherInput{ID: id, Title: matchParam(row.Title), Author: matchParam(row.Author), ISBN: isbn})
		}
	}
	return response, nil
}

type matcherLookupResponse struct {
	api      *API
	ctx      context.Context
	provider MetadataProvider
	ready    []BookMatcherOutcome
	books    []metadata.MatcherInput
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
	return r.api.runMatcherLookups(r.ctx, r.provider, r.books, emit)
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
