package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

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
	ctx = requestContext(ctx)
	api, body := s.api, r.Body
	mode := LinkOnly
	if body.MetadataMode != nil {
		mode = *body.MetadataMode
	}
	namespace := workNamespaces[r.Provider]
	id, workID := r.Id, body.WorkId
	changed := []BookMatcherChangedField{}
	response := func() ConfirmBookMatchResponseObject {
		if mode == LinkOnly {
			return ConfirmBookMatch204Response{}
		}
		return ConfirmBookMatch200JSONResponse{ChangedFields: changed}
	}

	read, err := api.db.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	_, linked, err := bookMatcherLinkState(ctx, api.db.Queries.WithTx(read), id, namespace, workID)
	_ = read.Rollback()
	if err != nil || linked {
		if err != nil {
			return nil, err
		}
		return response(), nil
	}

	var edition, isbn string
	if mode != LinkOnly {
		edition, isbn = matchParam(body.EditionId), matchParam(body.Isbn)
	}
	match, err := api.resolveMatcherLink(ctx, r.Provider, workID, edition, isbn, mode == LinkOnly)
	if err != nil {
		return nil, err
	}
	var staged string
	var coverErr error
	coverCommitted := false
	defer func() {
		if staged != "" && !coverCommitted {
			_ = os.Remove(filepath.Join(api.cfg.DataPath, "covers", staged))
		}
	}()
	if mode != LinkOnly && match.CoverID != nil {
		staged, coverErr = api.stageMatcherCover(ctx, r.Provider, match)
	}
	if mode != LinkOnly {
		if !api.libraryWrite.TryLock() {
			return nil, adminFailure(409, "server_busy")
		}
		defer api.libraryWrite.Unlock()
	}

	tx, err := api.db.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	queries := api.db.Queries.WithTx(tx)
	doc, linked, err := bookMatcherLinkState(ctx, queries, id, namespace, workID)
	if err != nil {
		return nil, err
	}
	if linked {
		return response(), nil
	}
	var cover *string
	if mode != LinkOnly {
		if coverErr != nil && (mode != FillMissing || !api.documentCoverAvailable(doc)) {
			return nil, coverErr
		}
		fields, modified := api.matcherMetadataPatch(doc, match, staged, mode == FillMissing)
		changed, cover = modified, fields.Coverfile
		if len(changed) != 0 {
			if _, err := queries.UpdateWebDocumentMetadata(ctx, fields); err != nil {
				return nil, err
			}
		}
	}
	if err := queries.LinkDocumentIdentifier(ctx, database.LinkDocumentIdentifierParams{DocumentID: id, Namespace: namespace, Value: workID}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	coverCommitted = cover != nil
	return response(), nil
}

func (api *API) matcherMetadataPatch(doc database.Document, match metadata.LookupMatch, cover string, fill bool) (database.UpdateWebDocumentMetadataParams, []BookMatcherChangedField) {
	changed := []BookMatcherChangedField{}
	pick := func(field BookMatcherChangedField, existing *string, value string) *string {
		value = strings.TrimSpace(value)
		old := matchParam(existing)
		if value == "" || old == value || fill && strings.TrimSpace(old) != "" {
			return nil
		}
		changed = append(changed, field)
		return &value
	}
	pickISBN := func(field BookMatcherChangedField, existing, source *string, length int) *string {
		isbn := matchParam(source)
		if len(isbn) != length || !metadata.ValidMatcherISBN(isbn) {
			return nil
		}
		return pick(field, existing, isbn)
	}
	patch := database.UpdateWebDocumentMetadataParams{
		ID:          doc.ID,
		Title:       pick(BookMatcherChangedFieldTitle, doc.Title, match.Title),
		Author:      pick(BookMatcherChangedFieldAuthor, doc.Author, match.Author),
		Description: pick(BookMatcherChangedFieldDescription, doc.Description, matchParam(match.Description)),
		Isbn10:      pickISBN(BookMatcherChangedFieldIsbn10, doc.Isbn10, match.ISBN10, 10),
		Isbn13:      pickISBN(BookMatcherChangedFieldIsbn13, doc.Isbn13, match.ISBN13, 13),
	}
	if cover != "" && (!fill || !api.documentCoverAvailable(doc)) {
		patch.Coverfile = &cover
		changed = append(changed, BookMatcherChangedFieldCover)
	}
	return patch, changed
}

func (s *webAPI) UnlinkBookMatch(ctx context.Context, r UnlinkBookMatchRequestObject) (UnlinkBookMatchResponseObject, error) {
	ctx = requestContext(ctx)
	tx, err := s.api.db.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	queries := s.api.db.Queries.WithTx(tx)
	namespace := workNamespaces[r.Provider]
	if _, linked, err := bookMatcherLinkState(ctx, queries, r.Id, namespace, r.Params.WorkId); err != nil {
		return nil, err
	} else if !linked {
		return UnlinkBookMatch204Response{}, nil
	}
	if err := queries.UnlinkBookMatcherDocument(ctx, database.UnlinkBookMatcherDocumentParams{DocumentID: r.Id, Namespace: namespace, WorkID: r.Params.WorkId}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return UnlinkBookMatch204Response{}, nil
}

func bookMatcherLinkState(ctx context.Context, queries *database.Queries, id, namespace, workID string) (database.Document, bool, error) {
	doc, err := queries.GetDocument(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || err == nil && doc.Deleted {
		return doc, false, &reading.Failure{Status: http.StatusNotFound, Code: "not_found"}
	}
	if err != nil {
		return doc, false, err
	}
	links, err := queries.ListDocumentIdentifiers(ctx, id)
	if err != nil {
		return doc, false, err
	}
	linked := false
	for _, link := range links {
		if link.Namespace != namespace {
			continue
		}
		if link.Value != workID {
			return doc, false, &reading.Failure{Status: http.StatusConflict, Code: "book_match_changed"}
		}
		linked = true
	}
	return doc, linked, nil
}
