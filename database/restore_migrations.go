package database

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"io/fs"

	"github.com/pressly/goose/v3"
	dbmigrations "reichard.io/antholume/database/migrations"
)

const PreReactSchemaVersion int64 = 20240510123707
const ReactSchemaVersion int64 = 20261126000000

//go:embed historical/20240510123707.sql
var preReactSchema string

//go:embed historical/20261126000000.sql
var firstReactSchema string

func restoreMigrationProvider(db *sql.DB) (*goose.Provider, error) {
	files, err := fs.Sub(migrations, "migrations")
	if err != nil {
		return nil, err
	}
	return goose.NewProvider(goose.DialectSQLite3, db, files)
}

func InitHistoricalSchema(ctx context.Context, db *sql.DB, version int64) error {
	var schema string
	switch version {
	case PreReactSchemaVersion:
		schema = preReactSchema
	case ReactSchemaVersion:
		schema = firstReactSchema
	default:
		return errors.New("unsupported historical schema")
	}
	_, err := db.ExecContext(ctx, schema)
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
