package api

import (
	"context"
	"errors"
	"strings"

	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/reading"
)

type metadataResolver func(ctx context.Context, work, edition, isbn string) (metadata.LookupMatch, error)

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
	resolve := api.openLibrary
	if ref.Provider == Hardcover {
		resolve = api.catalog.Resolve
	}
	m, err := resolve(ctx, ref.WorkId, matchParam(ref.EditionId), matchParam(ref.Isbn))
	if err != nil {
		return metadata.LookupMatch{}, metadataLookupFailure(err)
	}
	if m.ID != ref.WorkId {
		return metadata.LookupMatch{}, metadataLookupFailure(metadata.ErrInvalidLookupMatch)
	}
	return m, nil
}

// Confirmed Namespaces - The legacy openlibrary namespace may contain works, editions, or unclassified values.
// Keep it separate, and retain hardcover for links already saved by the first version of the provider.
var workNamespaces = map[MetadataProvider]string{Openlibrary: "openlibrary_work", Hardcover: "hardcover"}

func documentMatches(ctx context.Context, queries *database.Queries, id string) (*[]DocumentMatch, error) {
	rows, err := queries.ListDocumentIdentifiers(ctx, id)
	if err != nil {
		return nil, err
	}
	matches := make([]DocumentMatch, 0, len(rows))
	for _, row := range rows {
		for provider, namespace := range workNamespaces {
			if row.Namespace == namespace {
				matches = append(matches, DocumentMatch{Provider: provider, WorkId: row.Value})
				break
			}
		}
	}
	return &matches, nil
}
