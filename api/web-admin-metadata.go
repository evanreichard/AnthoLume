package api

import (
	"context"
	"database/sql"

	"reichard.io/antholume/database"
)

func (api *API) metadataProviderStatus(ctx context.Context, queries *database.Queries) (AdminMetadataProvider, error) {
	selected, err := queries.GetMetadataProvider(ctx)
	if err != nil {
		return AdminMetadataProvider{}, err
	}
	return api.metadataProviderChoice(MetadataProvider(selected)), nil
}

func (api *API) metadataProviderChoice(selected MetadataProvider) AdminMetadataProvider {
	state := AdminMetadataProvider{Selected: selected, Effective: selected, HardcoverAvailable: api.catalog != nil}
	if selected == Hardcover && !state.HardcoverAvailable {
		state.Effective = Openlibrary
	}
	return state
}

func (s *webAPI) GetAdminMetadataProvider(ctx context.Context, _ GetAdminMetadataProviderRequestObject) (GetAdminMetadataProviderResponseObject, error) {
	if !webUser(ctx).IsAdmin {
		return nil, adminFailure(403, "forbidden")
	}
	state, err := s.api.metadataProviderStatus(requestContext(ctx), s.api.db.Queries)
	if err != nil {
		return nil, err
	}
	return GetAdminMetadataProvider200JSONResponse(state), nil
}

func (s *webAPI) SetAdminMetadataProvider(ctx context.Context, r SetAdminMetadataProviderRequestObject) (SetAdminMetadataProviderResponseObject, error) {
	choice := r.Body.Provider
	if err := s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		if choice == Hardcover && s.api.catalog == nil {
			return adminFailure(409, "hardcover_catalog_unconfigured")
		}
		return s.api.db.Queries.WithTx(tx).SetMetadataProvider(ctx, string(choice))
	}); err != nil {
		return nil, err
	}
	return SetAdminMetadataProvider200JSONResponse(s.api.metadataProviderChoice(choice)), nil
}
