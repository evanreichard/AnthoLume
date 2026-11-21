package api

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"

	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/pkg/storagepath"
)

func (s *webAPI) RepairAdminBackupPath(ctx context.Context, r RepairAdminBackupPathRequestObject) (RepairAdminBackupPathResponseObject, error) {
	api := s.api
	if !webUser(ctx).IsAdmin || api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	if r.Body == nil {
		return nil, adminFailure(400, "invalid_request")
	}
	b := *r.Body
	if b.Kind != Book && b.Kind != Cover {
		return nil, adminFailure(400, "invalid_request")
	}
	clear := b.ConfirmClear != nil && *b.ConfirmClear
	if b.Path == nil {
		if !clear || b.RootId != nil {
			return nil, adminFailure(400, "invalid_request")
		}
	} else if clear || !storagepath.Valid(*b.Path) ||
		(b.RootId != nil && (b.Kind != Book || !storageRootID.MatchString(*b.RootId))) {
		return nil, adminFailure(400, "invalid_request")
	}
	if !api.libraryWrite.TryLock() {
		return nil, adminFailure(409, "server_busy")
	}
	defer api.libraryWrite.Unlock()

	err := s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		q := api.db.Queries.WithTx(tx)
		doc, err := q.GetDocument(ctx, b.DocumentId)
		if errors.Is(err, sql.ErrNoRows) {
			return adminFailure(404, "not_found")
		}
		if err != nil {
			return err
		}

		if b.Kind == Cover {
			if !invalidLegacyRepairPath(doc.Coverfile) {
				return adminFailure(409, "path_not_invalid")
			}
			if b.Path != nil {
				if err := api.verifyBackupCoverReplacement(*b.Path); err != nil {
					return err
				}
			}
			return q.SetBackupDocumentPaths(ctx, database.SetBackupDocumentPathsParams{
				ID: doc.ID, Filepath: doc.Filepath, Coverfile: b.Path,
			})
		}

		invalid := invalidLegacyRepairPath(doc.Filepath)
		if !invalid && doc.StorageRootID != nil {
			_, err := q.GetStorageRoot(ctx, *doc.StorageRootID)
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			invalid = errors.Is(err, sql.ErrNoRows)
		}
		if !invalid {
			return adminFailure(409, "path_not_invalid")
		}
		var replacementRoot *string
		if b.Path != nil {
			rootID := libraryRoot
			if b.RootId != nil {
				rootID = *b.RootId
			}
			if err := api.verifyBackupBookReplacement(ctx, tx, doc, rootID, *b.Path); err != nil {
				return err
			}
			replacementRoot = &rootID
		}
		return q.SetRestoredDocumentPaths(ctx, database.SetRestoredDocumentPathsParams{
			ID: doc.ID, Filepath: b.Path, StorageRootID: replacementRoot, Coverfile: doc.Coverfile,
		})
	})
	if err != nil {
		return nil, err
	}
	return RepairAdminBackupPath204Response{}, nil
}

func (api *API) verifyBackupBookReplacement(ctx context.Context, tx *sql.Tx, doc database.Document, rootID, name string) error {
	if !strings.EqualFold(filepath.Ext(name), string(metadata.TYPE_EPUB)) {
		return adminFailure(400, "invalid_replacement_file")
	}
	root, err := api.queryStorageRoot(ctx, tx, rootID)
	if errors.Is(err, sql.ErrNoRows) {
		return adminFailure(404, "storage_root_not_found")
	}
	if err != nil {
		return err
	}
	file, err := openStoredFile(root.Path, name)
	if err != nil {
		return adminFailure(400, "invalid_replacement_file")
	}
	defer file.Close()
	info, err := metadata.GetOpenedMetadata(file)
	if err != nil {
		return adminFailure(400, "invalid_replacement_file")
	}
	if doc.ID != *info.PartialMD5 {
		return adminFailure(409, "book_identity_mismatch")
	}
	return nil
}

func (api *API) verifyBackupCoverReplacement(name string) error {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".tif", ".tiff", ".webp":
	default:
		return adminFailure(400, "invalid_replacement_file")
	}
	file, err := openStoredFile(filepath.Join(api.cfg.DataPath, "covers"), name)
	if err != nil {
		return adminFailure(400, "invalid_replacement_file")
	}
	return file.Close()
}
