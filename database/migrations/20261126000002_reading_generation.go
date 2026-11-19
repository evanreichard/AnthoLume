package migrations

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"

	"github.com/pressly/goose/v3"
)

//go:embed schema/reading_generation_schema.sql
var readingGenerationSchema string

func init() { goose.AddMigrationContext(upReadingGeneration, downReadingGeneration) }

func upReadingGeneration(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, readingGenerationSchema)
	return err
}

func downReadingGeneration(context.Context, *sql.Tx) error {
	return errors.New("reading generation downgrade is unsafe")
}
