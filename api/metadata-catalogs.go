package api

import (
	"context"
	"net/http"

	"reichard.io/antholume/hardcover"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/reading"
)

type catalogProvider interface {
	Lookup(context.Context, string) ([]metadata.LookupMatch, error)
	Resolve(ctx context.Context, work, edition, isbn string) (metadata.LookupMatch, error)
	LookupMatcherBatch(context.Context, []metadata.MatcherInput, func(string, []metadata.LookupMatch, error) error) error
	Cover(context.Context, int64) ([]byte, error)
	CoverFromMatch(context.Context, metadata.LookupMatch) ([]byte, error)
}

func newMetadataCatalogs(catalogToken string) map[MetadataProvider]catalogProvider {
	catalogs := map[MetadataProvider]catalogProvider{Openlibrary: metadata.OpenLibraryCatalog{}}
	if catalogToken != "" {
		catalogs[Hardcover] = hardcover.NewCatalog(catalogToken)
	}
	return catalogs
}

func (api *API) catalogFor(provider MetadataProvider) (catalogProvider, error) {
	if catalog := api.metadataCatalogs[provider]; catalog != nil {
		return catalog, nil
	}
	return nil, &reading.Failure{Status: http.StatusServiceUnavailable, Code: "metadata_unavailable"}
}
