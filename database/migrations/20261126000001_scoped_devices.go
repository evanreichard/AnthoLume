package migrations

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"

	"github.com/pressly/goose/v3"
)

//go:embed schema/scoped_device_schema.sql
var scopedDeviceSchema string

func init() { goose.AddMigrationContext(upScopedDevices, downReactUpgrade) }

func scopedDevices(ctx context.Context, tx *sql.Tx) (bool, error) {
	var scoped bool
	err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM pragma_table_info('devices') WHERE name='user_id' AND pk=1)`).Scan(&scoped)
	return scoped, err
}

func upScopedDevices(ctx context.Context, tx *sql.Tx) error {
	scoped, err := scopedDevices(ctx, tx)
	if err != nil || scoped {
		return err
	}
	var foreignKeys bool
	if err := tx.QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&foreignKeys); err != nil {
		return err
	}
	if foreignKeys {
		return errors.New("device key migration requires foreign keys disabled on its private connection")
	}
	// Historical Ownership - Older clients could write history under another account's device row. Give each history owner its own row.
	_, err = tx.ExecContext(ctx, `
CREATE TEMP TABLE device_key_map AS
WITH pairs(user_id, old_id) AS (
 SELECT user_id,id FROM devices UNION SELECT user_id,device_id FROM activity
 UNION SELECT user_id,device_id FROM document_progress UNION SELECT user_id,device_id FROM reading_heads WHERE device_id IS NOT NULL
)
SELECT p.user_id,p.old_id,COALESCE(k.external_id,p.old_id) AS new_id,d.device_name,d.last_synced,d.created_at,d.sync,(d.user_id=p.user_id) AS owned
FROM pairs p LEFT JOIN devices d ON d.id=p.old_id LEFT JOIN kosync_device_aliases k ON k.user_id=p.user_id AND k.device_id=p.old_id;
CREATE TEMP TABLE saved_devices AS
SELECT DISTINCT new_id AS id,user_id,
 FIRST_VALUE(COALESCE(device_name,'')) OVER win AS device_name,
 MAX(COALESCE(last_synced,'1970-01-01T00:00:00Z')) OVER (PARTITION BY user_id,new_id) AS last_synced,
 MIN(COALESCE(created_at,'1970-01-01T00:00:00Z')) OVER (PARTITION BY user_id,new_id) AS created_at,
 FIRST_VALUE(COALESCE(sync,1)) OVER win AS sync
FROM device_key_map WINDOW win AS (PARTITION BY user_id,new_id ORDER BY owned DESC,(old_id=new_id) DESC,old_id);
CREATE TEMP TABLE saved_progress AS
SELECT user_id,document_id,device_id,percentage,progress,created_at FROM (
 SELECT p.user_id,p.document_id,m.new_id AS device_id,p.percentage,p.progress,p.created_at,
 ROW_NUMBER() OVER (PARTITION BY p.user_id,p.document_id,m.new_id ORDER BY p.created_at DESC,p.device_id) AS rank
 FROM document_progress p JOIN device_key_map m ON m.user_id=p.user_id AND m.old_id=p.device_id
) WHERE rank=1;
CREATE TEMP TABLE saved_activity AS
SELECT a.id,a.user_id,a.document_id,m.new_id AS device_id,a.start_time,a.start_percentage,a.end_percentage,a.duration,a.created_at
FROM activity a JOIN device_key_map m ON m.user_id=a.user_id AND m.old_id=a.device_id;
CREATE TEMP TABLE saved_heads AS
SELECT h.user_id,h.document_id,h.revision,h.position,h.fraction,m.new_id AS device_id,h.updated_at
FROM reading_heads h LEFT JOIN device_key_map m ON m.user_id=h.user_id AND m.old_id=h.device_id;
CREATE TEMP TABLE saved_preferences AS
SELECT user_id,device_id,label,archived FROM (
 SELECT m.user_id,m.new_id AS device_id,p.label,p.archived,
 ROW_NUMBER() OVER (PARTITION BY m.user_id,m.new_id ORDER BY (m.old_id=m.new_id) DESC,m.old_id) AS rank
 FROM device_preferences p JOIN device_key_map m ON m.old_id=p.device_id AND m.owned
) WHERE rank=1;`)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, scopedDeviceSchema); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
INSERT INTO devices SELECT * FROM saved_devices;
INSERT INTO document_progress SELECT * FROM saved_progress;
INSERT INTO activity SELECT * FROM saved_activity;
INSERT INTO reading_heads SELECT * FROM saved_heads;
INSERT INTO device_preferences SELECT * FROM saved_preferences;
DROP TABLE saved_devices; DROP TABLE saved_progress; DROP TABLE saved_activity; DROP TABLE saved_heads; DROP TABLE saved_preferences; DROP TABLE device_key_map;
`+ReadingSchema)
	return err
}
