package migrations

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"

	"github.com/pressly/goose/v3"
)

//go:embed schema/document_identifiers.sql
var documentIdentifiersSQL string

func init() {
	goose.AddMigrationContext(upDocumentIdentifiers, downDocumentIdentifiers)
}

func upDocumentIdentifiers(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, documentIdentifiersSQL)
	return err
}

func downDocumentIdentifiers(context.Context, *sql.Tx) error {
	return errors.New("document identifier downgrade is unsafe: the legacy columns cannot represent all identifiers; restore a compatible backup")
}
