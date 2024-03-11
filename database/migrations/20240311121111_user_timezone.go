package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddMigrationContext(upUserTimezone, downUserTimezone)
}

func upUserTimezone(ctx context.Context, tx *sql.Tx) error {
	// Determine if we have a new DB or not
	isNew := ctx.Value("isNew").(bool)
	if isNew {
		return nil
	}

	// Copy table & create column
	_, err := tx.Exec(`
	  -- Copy Table
	  CREATE TABLE temp_users AS SELECT * FROM users;
	  ALTER TABLE temp_users DROP COLUMN time_offset;
	  ALTER TABLE temp_users ADD COLUMN timezone TEXT;
	  UPDATE temp_users SET timezone = 'Europe/London';

	  -- Clean Table
	  DELETE FROM users;
	  ALTER TABLE users DROP COLUMN time_offset;
	  ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/London';

	  -- Copy Temp Table -> Clean Table
	  INSERT INTO users SELECT * FROM temp_users;

	  -- Drop Temp Table
	  DROP TABLE temp_users;
	`)
	if err != nil {
		return err
	}

	return nil
}

func downUserTimezone(ctx context.Context, tx *sql.Tx) error {
	// Update column name & value
	_, err := tx.Exec(`
	  ALTER TABLE users RENAME COLUMN timezone TO time_offset;
	  UPDATE users SET time_offset = '0 hours';
	`)
	if err != nil {
		return err
	}

	return nil
}
