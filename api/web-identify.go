package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/reading"
)

type catalogProvider interface {
	Lookup(context.Context, string) ([]metadata.LookupMatch, error)
	Resolve(ctx context.Context, work, edition, isbn string) (metadata.LookupMatch, error)
}

type hardcoverCatalogProvider interface {
	catalogProvider
	Cover(context.Context, int64) ([]byte, error)
}

func (api *API) catalogFor(provider MetadataProvider) (catalogProvider, error) {
	switch provider {
	case Openlibrary:
		if api.openLibraryCatalog != nil {
			return api.openLibraryCatalog, nil
		}
	case Hardcover:
		if api.hardcoverCatalog != nil {
			return api.hardcoverCatalog, nil
		}
	}
	return nil, &reading.Failure{Status: 503, Code: "metadata_unavailable"}
}

func (s *webAPI) LookupMetadata(ctx context.Context, r LookupMetadataRequestObject) (LookupMetadataResponseObject, error) {
	q := strings.TrimSpace(r.Params.Q)
	if len([]rune(q)) < 2 {
		return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
	}
	ctx = requestContext(ctx)
	state, err := s.api.metadataProviderStatus(ctx, s.api.db.Queries)
	if err != nil {
		return nil, err
	}
	catalog, err := s.api.catalogFor(state.Effective)
	if err != nil {
		return nil, err
	}
	matches, err := catalog.Lookup(ctx, q)
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
	ref := MetadataMatchReference{Provider: r.Params.Provider, WorkId: r.Params.WorkId, EditionId: r.Params.EditionId, Isbn: r.Params.Isbn}
	m, err := s.api.resolveMetadataMatch(requestContext(ctx), ref)
	if err != nil {
		return nil, err
	}
	return PreviewMetadataMatch200JSONResponse(metadataMatch(ref.Provider, m)), nil
}

func matchParam(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (api *API) checkMetadataProvider(ctx context.Context, queries *database.Queries, provider MetadataProvider) error {
	state, err := api.metadataProviderStatus(ctx, queries)
	if err != nil {
		return err
	}
	if state.Effective != provider {
		return &reading.Failure{Status: 409, Code: "metadata_provider_changed"}
	}
	return nil
}

func (api *API) resolveMetadataMatch(ctx context.Context, ref MetadataMatchReference) (metadata.LookupMatch, error) {
	if err := api.checkMetadataProvider(ctx, api.db.Queries, ref.Provider); err != nil {
		return metadata.LookupMatch{}, err
	}
	return api.resolveCatalogMatch(ctx, ref)
}

func (api *API) resolveCatalogMatch(ctx context.Context, ref MetadataMatchReference) (metadata.LookupMatch, error) {
	catalog, err := api.catalogFor(ref.Provider)
	if err != nil {
		return metadata.LookupMatch{}, err
	}
	m, err := catalog.Resolve(ctx, ref.WorkId, matchParam(ref.EditionId), matchParam(ref.Isbn))
	if err != nil {
		return metadata.LookupMatch{}, metadataLookupFailure(err)
	}
	if m.ID != ref.WorkId {
		return metadata.LookupMatch{}, metadataLookupFailure(metadata.ErrInvalidLookupMatch)
	}
	return m, nil
}

// Confirmed Namespaces - The legacy openlibrary namespace may contain works, editions, or unclassified values.
var workNamespaces = map[MetadataProvider]string{Openlibrary: "openlibrary_work", Hardcover: "hardcover_book"}

func (s *webAPI) GetLinkedMetadata(ctx context.Context, r GetLinkedMetadataRequestObject) (GetLinkedMetadataResponseObject, error) {
	ctx = requestContext(ctx)
	link := DocumentMatch{Provider: r.Provider, WorkId: r.Params.WorkId}
	if err := s.api.checkLinkedSource(ctx, r.Id, link); err != nil {
		return nil, err
	}
	match, err := s.api.resolveCatalogMatch(ctx, MetadataMatchReference{Provider: link.Provider, WorkId: link.WorkId})
	if err != nil {
		return nil, err
	}
	if err := s.api.checkLinkedSource(ctx, r.Id, link); err != nil {
		return nil, err
	}
	return GetLinkedMetadata200JSONResponse(metadataMatch(link.Provider, match)), nil
}

func (api *API) checkLinkedSource(ctx context.Context, id string, expected DocumentMatch) error {
	tx, err := api.db.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	return requireLinkedSource(ctx, api.db.Queries.WithTx(tx), id, expected)
}

func requireLinkedSource(ctx context.Context, queries *database.Queries, id string, expected DocumentMatch) error {
	doc, err := queries.GetDocument(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || err == nil && doc.Deleted {
		return &reading.Failure{Status: http.StatusNotFound, Code: "not_found"}
	}
	if err != nil {
		return err
	}
	namespace := workNamespaces[expected.Provider]
	links, err := queries.ListDocumentIdentifiers(ctx, id)
	if err != nil {
		return err
	}
	conflict := &reading.Failure{Status: http.StatusConflict, Code: "book_match_changed"}
	var found bool
	for _, link := range links {
		if link.Namespace != namespace {
			continue
		}
		if link.Value != expected.WorkId {
			return conflict
		}
		found = true
	}
	if !found {
		return conflict
	}
	return nil
}

func listedDocumentMatches(ctx context.Context, queries *database.Queries, ids []string) (map[string][]DocumentMatch, error) {
	rows, err := queries.ListDocumentIdentifiersForPage(ctx, ids)
	if err != nil {
		return nil, err
	}
	matches := make(map[string][]DocumentMatch, len(ids))
	for _, row := range rows {
		if link, ok := confirmedDocumentMatch(row.Namespace, row.Value); ok {
			matches[row.DocumentID] = append(matches[row.DocumentID], link)
		}
	}
	return matches, nil
}

func confirmedDocumentMatch(namespace, workID string) (DocumentMatch, bool) {
	for provider, ns := range workNamespaces {
		if ns == namespace {
			return DocumentMatch{Provider: provider, WorkId: workID}, true
		}
	}
	return DocumentMatch{}, false
}

func documentMatches(ctx context.Context, queries *database.Queries, id string) (*[]DocumentMatch, error) {
	rows, err := queries.ListDocumentIdentifiers(ctx, id)
	if err != nil {
		return nil, err
	}
	matches := make([]DocumentMatch, 0, len(rows))
	for _, row := range rows {
		if link, ok := confirmedDocumentMatch(row.Namespace, row.Value); ok {
			matches = append(matches, link)
		}
	}
	return &matches, nil
}
