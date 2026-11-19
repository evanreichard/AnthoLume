package api

import (
	"context"

	"reichard.io/antholume/metadata"
)

// attachCatalogFile leaves existing placements to the explicit relink workflow.
// A partial fingerprint identifies the catalog row, but cannot override a known full checksum.
func (api *API) attachCatalogFile(ctx context.Context, root, path string, m *metadata.MetadataInfo) (bool, error) {
	result, err := api.db.DB.ExecContext(ctx, `
 INSERT INTO documents(id,md5,filepath,storage_root_id,title,author,description,words,isbn10,isbn13)
 VALUES(?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET
   md5=excluded.md5, filepath=excluded.filepath, storage_root_id=excluded.storage_root_id,
   title=COALESCE(documents.title,excluded.title), author=COALESCE(documents.author,excluded.author),
   description=COALESCE(documents.description,excluded.description), words=COALESCE(documents.words,excluded.words),
   isbn10=COALESCE(documents.isbn10,excluded.isbn10), isbn13=COALESCE(documents.isbn13,excluded.isbn13)
 WHERE NOT documents.deleted AND documents.filepath IS NULL
   AND (documents.md5 IS NULL OR documents.md5=excluded.md5)`, *m.PartialMD5, m.MD5, path, root, m.Title, m.Author, m.Description, m.WordCount, m.ISBN10, m.ISBN13)
	if err != nil {
		return false, err
	}
	n, err := result.RowsAffected()
	return n == 1, err
}
