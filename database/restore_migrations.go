package database

import (
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"strings"

	"github.com/pressly/goose/v3"
	dbmigrations "reichard.io/antholume/database/migrations"
)

const PreReactSchemaVersion int64 = 20240510123707
const ReactSchemaVersion int64 = 20261126000000

func restoreMigrationProvider(db *sql.DB) (*goose.Provider, error) {
	files, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return nil, err
	}
	return goose.NewProvider(goose.DialectSQLite3, db, files)
}

// InitRestoreSchema builds a trusted reference, never from the uploaded SQL.
func InitPreReactSchema(ctx context.Context, db *sql.DB) error {
	return InitHistoricalSchema(ctx, db, PreReactSchemaVersion)
}

func InitHistoricalSchema(ctx context.Context, db *sql.DB, version int64) error {
	schema := ddl + dbmigrations.ReadingSchema
	if version == PreReactSchemaVersion {
		before, rest, storage := strings.Cut(ddl, "-- Document storage\n")
		_, books, documents := strings.Cut(rest, "-- Books / Documents\n")
		const rootColumn = ",\n    storage_root_id TEXT REFERENCES storage_roots (id)"
		if !storage || !documents || !strings.Contains(books, rootColumn) {
			return errors.New("cannot build the pre-React schema reference")
		}
		schema = before + strings.Replace(books, rootColumn, "", 1)
	} else if version != ReactSchemaVersion {
		return errors.New("unsupported historical schema")
	}
	if _, err := db.ExecContext(ctx, schema); err != nil {
		return err
	}
	provider, err := restoreMigrationProvider(db)
	if err != nil {
		return err
	}
	ctx = context.WithValue(ctx, "isNew", true) // Existing Goose bootstrap contract.
	_, err = provider.UpTo(ctx, version)
	return err
}

func MigrateRestore(ctx context.Context, db *sql.DB, dataPath string) error {
	provider, err := restoreMigrationProvider(db)
	if err != nil {
		return err
	}
	ctx = dbmigrations.WithRestoreStorageDataPath(context.WithValue(ctx, "isNew", false), dataPath)
	_, err = provider.Up(ctx)
	return err
}
