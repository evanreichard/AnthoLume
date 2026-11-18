package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() { goose.AddMigrationContext(upDevicePreferences, downDevicePreferences) }

// Separate Labels - Sync clients can continue reporting their own names without overwriting account preferences.
const DevicePreferencesSchema = `
CREATE TABLE IF NOT EXISTS device_preferences (
 device_id TEXT NOT NULL PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
 label TEXT NOT NULL,
 archived BOOLEAN NOT NULL CHECK (archived IN (0, 1))
);
`

func upDevicePreferences(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, DevicePreferencesSchema)
	return err
}

func downDevicePreferences(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, "DROP TABLE IF EXISTS device_preferences")
	return err
}
