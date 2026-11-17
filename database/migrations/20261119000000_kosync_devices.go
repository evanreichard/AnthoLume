package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/pressly/goose/v3"
)

func init() { goose.AddMigrationContext(upKOSyncDevices, downKOSyncDevices) }

const KOSyncDeviceSchema = `
CREATE TABLE IF NOT EXISTS kosync_device_aliases (
 user_id TEXT NOT NULL REFERENCES users(id),
 external_id TEXT NOT NULL,
 device_id TEXT NOT NULL REFERENCES devices(id),
 PRIMARY KEY(user_id, external_id)
);
CREATE TABLE IF NOT EXISTS reading_head_devices (
 user_id TEXT NOT NULL,
 document_id TEXT NOT NULL,
 external_id TEXT,
 device_name TEXT NOT NULL,
 PRIMARY KEY(user_id, document_id),
 FOREIGN KEY(user_id, document_id) REFERENCES reading_heads(user_id, document_id) ON DELETE CASCADE
);
CREATE TRIGGER IF NOT EXISTS kosync_alias_user_deleted BEFORE DELETE ON users BEGIN
 DELETE FROM kosync_device_aliases WHERE user_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS kosync_alias_device_deleted BEFORE DELETE ON devices BEGIN
 DELETE FROM kosync_device_aliases WHERE device_id=OLD.id;
END;
`

func upKOSyncDevices(ctx context.Context, tx *sql.Tx) error {
	if _, err := tx.ExecContext(ctx, KOSyncDeviceSchema); err != nil {
		return err
	}
	// Known Names - Old heads have no write-time name evidence; freeze only the currently known GET value.
	_, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO reading_head_devices(user_id,document_id,external_id,device_name)
 SELECT h.user_id,h.document_id,h.device_id,COALESCE(d.device_name,'')
 FROM reading_heads h LEFT JOIN devices d ON d.id=h.device_id`)
	return err
}

func downKOSyncDevices(context.Context, *sql.Tx) error {
	return fmt.Errorf("KOSync device downgrade is unsafe; restore a compatible backup with writes stopped")
}
