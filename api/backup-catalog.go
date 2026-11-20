package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"

	"reichard.io/antholume/database"
	"reichard.io/antholume/pkg/storagepath"
)

func invalidBackupPath(id string, kind AdminBackupPathKind) error {
	return &webFailure{status: http.StatusConflict, code: "invalid_backup_catalog", backupPathIssue: &AdminBackupPathIssue{DocumentId: id, Kind: kind}}
}

func validateBackupCatalog(ctx context.Context, q database.DBTX) ([]database.ListStorageRootsForRestoreRow, []database.ListDocumentsForRestoreRow, error) {
	queries := database.New(q)
	roots, err := queries.ListStorageRootsForRestore(ctx)
	if err != nil {
		return nil, nil, err
	}
	known := make(map[string]bool, len(roots))
	for _, root := range roots {
		if !storageRootID.MatchString(root.ID) || root.Managed != (root.ID == libraryRoot) {
			return nil, nil, errors.New("invalid snapshot storage root")
		}
		known[root.ID] = true
	}
	if !known[libraryRoot] {
		return nil, nil, errors.New("missing snapshot library root")
	}
	docs, err := queries.ListDocumentsForRestore(ctx)
	if err != nil {
		return nil, nil, err
	}
	for _, doc := range docs {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		if (doc.StorageRootID != nil && !known[*doc.StorageRootID]) || invalidLegacyRepairPath(doc.Filepath) {
			return nil, nil, invalidBackupPath(doc.ID, Book)
		}
		if invalidLegacyRepairPath(doc.Coverfile) {
			return nil, nil, invalidBackupPath(doc.ID, Cover)
		}
	}
	return roots, docs, nil
}

func validateBackupCatalogFile(ctx context.Context, name string) error {
	db, err := sql.Open("sqlite", snapshotURI(name))
	if err != nil {
		return err
	}
	defer db.Close()
	_, _, err = validateBackupCatalog(ctx, db)
	return err
}

func invalidLegacyRepairPath(name *string) bool {
	if name == nil {
		return false
	}
	_, ok := storagepath.NormalizeLegacy(*name)
	return !ok
}
