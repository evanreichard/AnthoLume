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
	state := AdminMetadataProvider{Selected: selected, Effective: selected, HardcoverAvailable: api.metadataCatalogs[Hardcover] != nil}
	if selected == Hardcover && !state.HardcoverAvailable {
		state.Effective = Openlibrary
	}
	return state
}

func (s *webAPI) GetMetadataProviders(ctx context.Context, _ GetMetadataProvidersRequestObject) (GetMetadataProvidersResponseObject, error) {
	state, err := s.api.metadataProviderStatus(requestContext(ctx), s.api.db.Queries)
	if err != nil {
		return nil, err
	}
	return GetMetadataProviders200JSONResponse(state), nil
}

func (s *webAPI) GetAdminMetadataProvider(ctx context.Context, _ GetAdminMetadataProviderRequestObject) (GetAdminMetadataProviderResponseObject, error) {
	state, err := s.api.metadataProviderStatus(requestContext(ctx), s.api.db.Queries)
	if err != nil {
		return nil, err
	}
	return GetAdminMetadataProvider200JSONResponse(state), nil
}

func (s *webAPI) SetAdminMetadataProvider(ctx context.Context, r SetAdminMetadataProviderRequestObject) (SetAdminMetadataProviderResponseObject, error) {
	choice := r.Body.Provider
	if err := s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		if choice == Hardcover && s.api.metadataCatalogs[Hardcover] == nil {
			return adminFailure(409, "hardcover_catalog_unconfigured")
		}
		_, err := s.api.db.Queries.WithTx(tx).UpdateSettings(ctx, database.UpdateSettingsParams{
			Name:  "metadata_provider",
			Value: string(choice),
		})
		return err
	}); err != nil {
		return nil, err
	}
	return SetAdminMetadataProvider200JSONResponse(s.api.metadataProviderChoice(choice)), nil
}
