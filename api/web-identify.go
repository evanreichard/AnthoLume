package api

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/reading"
)

type hardcoverCatalog interface {
	Lookup(context.Context, string) ([]metadata.LookupMatch, error)
	Resolve(ctx context.Context, work, edition, isbn string) (metadata.LookupMatch, error)
}

func (s *webAPI) LookupMetadata(ctx context.Context, r LookupMetadataRequestObject) (LookupMetadataResponseObject, error) {
	if s.api.cfg.DemoMode {
		return nil, &reading.Failure{Status: 403, Code: "forbidden"}
	}
	q := strings.TrimSpace(r.Params.Q)
	if len([]rune(q)) < 2 {
		return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
	}
	ctx = requestContext(ctx)
	state, err := s.api.metadataProviderStatus(ctx, s.api.db.Queries)
	if err != nil {
		return nil, err
	}
	lookup := metadata.LookupOpenLibrary
	if state.Effective == Hardcover {
		lookup = s.api.catalog.Lookup
	}
	matches, err := lookup(ctx, q)
	if err != nil {
		return nil, metadataLookupFailure(err)
	}
	out := make([]MetadataMatch, 0, len(matches))
	for _, m := range matches {
		out = append(out, metadataMatch(state.Effective, m))
	}
	return LookupMetadata200JSONResponse(out), nil
}

func metadataMatch(provider MetadataProvider, m metadata.LookupMatch) MetadataMatch {
	return MetadataMatch{Provider: provider, Id: m.ID, Title: m.Title, Author: m.Author, Year: m.Year, EditionId: m.EditionID, Publisher: m.Publisher, Published: m.Published, CoverId: m.CoverID, Description: m.Description, Isbn10: m.ISBN10, Isbn13: m.ISBN13}
}

func metadataLookupFailure(err error) error {
	if errors.Is(err, metadata.ErrInvalidLookupMatch) {
		return &reading.Failure{Status: 400, Code: "invalid_request"}
	}
	return &reading.Failure{Status: 503, Code: "metadata_unavailable"}
}

func (s *webAPI) PreviewMetadataMatch(ctx context.Context, r PreviewMetadataMatchRequestObject) (PreviewMetadataMatchResponseObject, error) {
	if s.api.cfg.DemoMode {
		return nil, &reading.Failure{Status: 403, Code: "forbidden"}
	}
	ctx = requestContext(ctx)
	state, err := s.api.metadataProviderStatus(ctx, s.api.db.Queries)
	if err != nil {
		return nil, err
	}
	provider := Hardcover
	if strings.HasPrefix(r.Params.WorkId, "OL") {
		provider = Openlibrary
	}
	if state.Effective != provider {
		return nil, &reading.Failure{Status: 409, Code: "metadata_provider_changed"}
	}
	resolve := metadata.ResolveOpenLibrary
	if provider == Hardcover {
		resolve = s.api.catalog.Resolve
	}
	m, err := resolve(ctx, r.Params.WorkId, matchParam(r.Params.EditionId), matchParam(r.Params.Isbn))
	if err != nil {
		return nil, metadataLookupFailure(err)
	}
	return PreviewMetadataMatch200JSONResponse(metadataMatch(provider, m)), nil
}

func matchParam(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s *webAPI) ConfirmHardcoverMatch(ctx context.Context, r ConfirmHardcoverMatchRequestObject) (ConfirmHardcoverMatchResponseObject, error) {
	api := s.api
	if api.cfg.DemoMode {
		return nil, &reading.Failure{Status: 403, Code: "forbidden"}
	}
	ctx = requestContext(ctx)
	state, err := api.metadataProviderStatus(ctx, api.db.Queries)
	if err != nil {
		return nil, err
	}
	providerChanged := &reading.Failure{Status: 409, Code: "metadata_provider_changed"}
	if state.Effective != Hardcover {
		return nil, providerChanged
	}
	b := r.Body
	m, err := api.catalog.Resolve(ctx, b.WorkId, matchParam(b.EditionId), matchParam(b.Isbn))
	if err != nil {
		return nil, metadataLookupFailure(err)
	}
	fields := database.ApplyIdentifiedMetadataParams{ID: r.Id}
	for _, field := range b.Fields {
		var value *string
		switch field {
		case HardcoverConfirmationFieldsTitle:
			value, fields.Title = &m.Title, &m.Title
		case HardcoverConfirmationFieldsAuthor:
			value, fields.Author = &m.Author, &m.Author
		case HardcoverConfirmationFieldsDescription:
			value, fields.Description = m.Description, m.Description
		case HardcoverConfirmationFieldsIsbn10:
			value, fields.Isbn10 = m.ISBN10, m.ISBN10
		case HardcoverConfirmationFieldsIsbn13:
			value, fields.Isbn13 = m.ISBN13, m.ISBN13
		}
		if value == nil || strings.TrimSpace(*value) == "" {
			return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
		}
	}
	if !api.libraryWrite.TryLock() {
		return nil, adminFailure(409, "server_busy")
	}
	defer api.libraryWrite.Unlock()
	tx, err := api.db.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	queries := api.db.Queries.WithTx(tx)
	state, err = api.metadataProviderStatus(ctx, queries)
	if err != nil {
		return nil, err
	}
	if state.Effective != Hardcover {
		return nil, providerChanged
	}
	doc, err := queries.GetDocument(ctx, r.Id)
	if errors.Is(err, sql.ErrNoRows) || err == nil && doc.Deleted {
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	if err != nil {
		return nil, err
	}
	if err = queries.RemoveOtherHardcoverIdentifiers(ctx, database.RemoveOtherHardcoverIdentifiersParams{DocumentID: r.Id, Value: m.ID}); err != nil {
		return nil, err
	}
	if err = queries.LinkHardcoverIdentifier(ctx, database.LinkHardcoverIdentifierParams{DocumentID: r.Id, Value: m.ID}); err != nil {
		return nil, err
	}
	if len(b.Fields) > 0 {
		if err = queries.ApplyIdentifiedMetadata(ctx, fields); err != nil {
			return nil, err
		}
		doc, err = queries.GetDocument(ctx, r.Id)
		if err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return ConfirmHardcoverMatch200JSONResponse(api.documentDTO(doc)), nil
}
