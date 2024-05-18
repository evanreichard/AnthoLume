package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddMigrationContext(upImportBasepath, downImportBasepath)
}

func upImportBasepath(ctx context.Context, tx *sql.Tx) error {
	// Determine if we have a new DB or not
	isNew := ctx.Value("isNew").(bool)
	if isNew {
		return nil
	}

	// Add basepath column
	_, err := tx.Exec(`ALTER TABLE documents ADD COLUMN basepath TEXT;`)
	if err != nil {
		return err
	}

	// This code is executed when the migration is applied.
	return nil
}

func downImportBasepath(ctx context.Context, tx *sql.Tx) error {
	// Drop basepath column
	_, err := tx.Exec("ALTER documents DROP COLUMN basepath;")
	if err != nil {
		return err
	}
	return nil
}
