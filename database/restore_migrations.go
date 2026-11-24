package database

import (
	"context"
	"database/sql"
	"io/fs"

	"github.com/pressly/goose/v3"
	dbmigrations "reichard.io/antholume/database/migrations"
)

func migrationProvider(db *sql.DB) (*goose.Provider, error) {
	files, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return nil, err
	}
	return goose.NewProvider(goose.DialectSQLite3, db, files)
}

func migrate(ctx context.Context, db *sql.DB, isNew bool) error {
	provider, err := migrationProvider(db)
	if err != nil {
		return err
	}
	_, err = provider.Up(context.WithValue(ctx, "isNew", isNew))
	return err
}

// MigrateRestore upgrades the staged database without trusting its stored filesystem paths.
func MigrateRestore(ctx context.Context, db *sql.DB, dataPath string) error {
	return migrate(dbmigrations.WithRestoreStorageDataPath(ctx, dataPath), db, false)
}
