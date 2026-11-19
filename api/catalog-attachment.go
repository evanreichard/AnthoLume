package api

import (
	"context"

	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
)

// attachCatalogFile leaves existing placements to the explicit relink workflow.
// A partial fingerprint identifies the catalog row, but cannot override a known full checksum.
func (api *API) attachCatalogFile(ctx context.Context, root, path string, m *metadata.MetadataInfo) (bool, error) {
	n, err := api.db.Queries.AttachCatalogFile(ctx, database.AttachCatalogFileParams{
		ID: *m.PartialMD5, Md5: m.MD5, Filepath: &path, StorageRootID: &root,
		Title: m.Title, Author: m.Author, Description: m.Description,
		Words: m.WordCount, Isbn10: m.ISBN10, Isbn13: m.ISBN13,
	})
	return n == 1, err
}
