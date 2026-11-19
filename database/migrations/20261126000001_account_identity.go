package migrations

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"

	"github.com/pressly/goose/v3"
)

//go:embed schema/account_identities_schema.sql
var accountIdentitiesSchema string

func init() { goose.AddMigrationContext(upAccountIdentity, downAccountIdentity) }

func upAccountIdentity(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, accountIdentitiesSchema)
	return err
}

func downAccountIdentity(context.Context, *sql.Tx) error {
	return errors.New("account identity downgrade is unsafe")
}
