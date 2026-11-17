package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/pressly/goose/v3"
)

func init() { goose.AddMigrationContext(upReading, downReading) }

// ReadingSchema is shared by fresh schema initialization and the additive upgrade.
const ReadingSchema = `
CREATE TABLE IF NOT EXISTS reading_heads (
 user_id TEXT NOT NULL REFERENCES users(id),
 document_id TEXT NOT NULL REFERENCES documents(id),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 999999999999999999),
 position TEXT, fraction REAL, device_id TEXT, updated_at TEXT,
 PRIMARY KEY(user_id, document_id)
);
CREATE TABLE IF NOT EXISTS reading_receipts (
 user_id TEXT NOT NULL REFERENCES users(id), event_id TEXT NOT NULL,
 document_id TEXT NOT NULL REFERENCES documents(id), kind TEXT NOT NULL,
 payload_version INTEGER NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL,
 observed_at TEXT NOT NULL, status INTEGER NOT NULL,
 revision TEXT, code TEXT NOT NULL, current_revision TEXT,
 PRIMARY KEY(user_id, event_id)
);
CREATE TRIGGER IF NOT EXISTS reading_user_deleted BEFORE DELETE ON users BEGIN
 DELETE FROM reading_receipts WHERE user_id=OLD.id;
 DELETE FROM reading_heads WHERE user_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS reading_document_deleted BEFORE DELETE ON documents BEGIN
 DELETE FROM reading_receipts WHERE document_id=OLD.id;
 DELETE FROM reading_heads WHERE document_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS reading_document_tombstoned AFTER UPDATE OF deleted ON documents
WHEN NEW.deleted=1 BEGIN
 DELETE FROM reading_receipts WHERE document_id=OLD.id;
 DELETE FROM reading_heads WHERE document_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS reading_progress_writer BEFORE INSERT ON document_progress BEGIN
 SELECT CASE WHEN READING_WRITER()!=1 THEN RAISE(ABORT,'reading writer required') END;
END;
CREATE TRIGGER IF NOT EXISTS reading_progress_update_writer BEFORE UPDATE ON document_progress BEGIN
 SELECT CASE WHEN READING_WRITER()!=1 THEN RAISE(ABORT,'reading writer required') END;
END;
CREATE TRIGGER IF NOT EXISTS reading_activity_writer BEFORE INSERT ON activity BEGIN
 SELECT CASE WHEN READING_WRITER()!=1 THEN RAISE(ABORT,'reading writer required') END;
END;
`

func upReading(ctx context.Context, tx *sql.Tx) error {
	if _, err := tx.ExecContext(ctx, ReadingSchema); err != nil {
		return err
	}
	// Historical Ambiguity - Second-resolution ties choose device ID ascending, never fraction or arrival time.
	// Historical Ownership - A prior device collision does not erase per-account resume evidence; only new writes require current ownership.
	_, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO reading_heads(user_id,document_id,revision,position,fraction,device_id,updated_at)
 SELECT user_id,document_id,0,progress,percentage,device_id,created_at FROM (
 SELECT p.*, ROW_NUMBER() OVER(PARTITION BY p.user_id,p.document_id ORDER BY p.created_at DESC,p.device_id ASC) AS rank
 FROM document_progress p JOIN users u ON u.id=p.user_id
 JOIN documents d ON d.id=p.document_id AND d.deleted=0
 ) WHERE rank=1`)
	return err
}

func downReading(context.Context, *sql.Tx) error {
	return fmt.Errorf("reading ledger downgrade is unsafe; restore a compatible backup with writes stopped")
}
