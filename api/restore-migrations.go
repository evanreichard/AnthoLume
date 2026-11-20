package api

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"reflect"

	"reichard.io/antholume/database"
)

func (api *API) upgradeRestoreSnapshot(ctx context.Context, name string, legacyArchive bool) error {
	if !legacyArchive && api.validateRestoreDB(ctx, name) == nil {
		return nil
	}
	info, err := os.Stat(name)
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxAdminBackupBytes {
		return errors.New("invalid snapshot file")
	}
	uri := (&url.URL{Scheme: "file", Path: name, RawQuery: "mode=rw&_pragma=trusted_schema(OFF)"}).String()
	snapshot, err := sql.Open("sqlite", uri)
	if err != nil {
		return err
	}
	defer snapshot.Close()
	snapshot.SetMaxOpenConns(1)
	var version int64
	if err := snapshot.QueryRowContext(ctx, `SELECT MAX(version_id) FROM goose_db_version WHERE is_applied = 1`).Scan(&version); err != nil || legacyArchive && version != database.PreReactSchemaVersion {
		return errors.New("unsupported historical snapshot version")
	}
	reference, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		return err
	}
	defer reference.Close()
	reference.SetMaxOpenConns(1)
	if err := database.InitHistoricalSchema(ctx, reference, version); err != nil {
		return err
	}
	expected, err := snapshotSchema(ctx, reference)
	if err != nil {
		return err
	}
	actual, err := snapshotSchema(ctx, snapshot)
	if err != nil || !reflect.DeepEqual(expected, actual) {
		return errors.New("unrecognized historical snapshot schema")
	}
	var integrity string
	if err := snapshot.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&integrity); err != nil || integrity != "ok" {
		return errors.New("snapshot integrity check failed")
	}
	if err := database.MigrateRestore(ctx, snapshot, api.cfg.DataPath); err != nil {
		return err
	}
	if legacyArchive {
		if err := linkLegacyLibrary(ctx, snapshot, filepath.Join(filepath.Dir(name), "documents", libraryRoot)); err != nil {
			return err
		}
	}
	if err := snapshot.Close(); err != nil {
		return err
	}
	return api.validateRestoreDB(ctx, name)
}

func linkLegacyLibrary(ctx context.Context, snapshot *sql.DB, bundled string) error {
	_, docs, err := validateBackupCatalog(ctx, snapshot)
	if err != nil {
		return err
	}
	q := database.New(snapshot)
	for _, doc := range docs {
		if doc.Filepath == nil || doc.StorageRootID == nil || doc.Deleted || *doc.StorageRootID == libraryRoot {
			continue
		}
		root, err := q.GetStorageRoot(ctx, *doc.StorageRootID)
		if err != nil {
			return err
		}
		// Legacy Library - The old exporter bundled the documents folder, not reference imports.
		if root.LegacyPath == nil || filepath.Base(filepath.Clean(*root.LegacyPath)) != "documents" {
			continue
		}
		if info, err := os.Stat(filepath.Join(bundled, filepath.FromSlash(*doc.Filepath))); err == nil && info.Mode().IsRegular() {
			id := libraryRoot
			if err := q.SetRestoredDocumentPaths(ctx, database.SetRestoredDocumentPathsParams{
				ID: doc.ID, Filepath: doc.Filepath, StorageRootID: &id, Coverfile: doc.Coverfile,
			}); err != nil {
				return err
			}
		}
	}
	return nil
}
