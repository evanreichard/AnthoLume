package migrations

import (
	"context"
	"database/sql"
	"errors"

	"github.com/pressly/goose/v3"
)

func init() { goose.AddMigrationContext(upReadingGeneration, downReadingGeneration) }

func upReadingGeneration(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS reading_generation (
 singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton=1),
 generation TEXT NOT NULL CHECK (length(generation)=32 AND generation NOT GLOB '*[^0-9a-f]*')
 );
 INSERT INTO reading_generation VALUES (1,lower(hex(randomblob(16)))) ON CONFLICT(singleton) DO NOTHING;`)
	return err
}

func downReadingGeneration(context.Context, *sql.Tx) error {
	return errors.New("reading generation downgrade is unsafe")
}
