package migrations

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"github.com/pressly/goose/v3"
	"os"
	"path/filepath"
	"reichard.io/antholume/pkg/storagepath"
)

func init() { goose.AddMigrationContext(upReactUpgrade, downReactUpgrade) }

func upReactUpgrade(ctx context.Context, tx *sql.Tx) error {
	for _, step := range []func(context.Context, *sql.Tx) error{
		upReading, upKOSyncDevices, upDevicePreferences, upAdminJobs, upAdminImportResults,
		upStorageRoots, upCanonicalStoragePaths, upAutoImportRules,
	} {
		if err := step(ctx, tx); err != nil {
			return err
		}
	}
	return nil
}

func downReactUpgrade(context.Context, *sql.Tx) error {
	return fmt.Errorf("reading ledger downgrade is unsafe; restore a compatible backup with writes stopped")
}

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

func upAdminJobs(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS admin_jobs (
 id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted')),
 started_at TEXT NOT NULL,
 finished_at TEXT,
 deadline TEXT NOT NULL
 );
 CREATE UNIQUE INDEX IF NOT EXISTS admin_jobs_running ON admin_jobs(kind) WHERE status='running';`)
	return err
}

func upAdminImportResults(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `SELECT name FROM pragma_table_info('admin_jobs') WHERE name='result'`)
	if err != nil {
		return err
	}
	exists := rows.Next()
	err = rows.Err()
	rows.Close()
	if err != nil || exists {
		return err
	}
	_, err = tx.ExecContext(ctx, `ALTER TABLE admin_jobs ADD COLUMN result BLOB`)
	return err
}

type storageDataPathKey struct{}

func WithStorageDataPath(ctx context.Context, path string) context.Context {
	return context.WithValue(ctx, storageDataPathKey{}, path)
}

func upStorageRoots(ctx context.Context, tx *sql.Tx) error {
	path, _ := ctx.Value(storageDataPathKey{}).(string)
	data, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS storage_roots (
 id TEXT NOT NULL PRIMARY KEY, label TEXT NOT NULL, path TEXT,
 managed BOOLEAN NOT NULL CHECK (managed IN (0, 1)), legacy_path TEXT
 ); INSERT OR IGNORE INTO storage_roots (id,label,managed) VALUES ('library','Library',1),('imports','Imports',0);`); err != nil {
		return err
	}
	var hasRootColumn bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM pragma_table_info('documents') WHERE name='storage_root_id')`).Scan(&hasRootColumn); err != nil {
		return err
	}
	if !hasRootColumn {
		if _, err := tx.ExecContext(ctx, `ALTER TABLE documents ADD COLUMN storage_root_id TEXT REFERENCES storage_roots (id)`); err != nil {
			return err
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT DISTINCT basepath FROM documents WHERE filepath IS NOT NULL AND COALESCE(basepath,'')<>''`)
	if err != nil {
		return err
	}
	var bases []string
	for rows.Next() {
		var base string
		if err := rows.Scan(&base); err != nil {
			rows.Close()
			return err
		}
		bases = append(bases, base)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, base := range bases {
		clean := filepath.Clean(base)
		id := "library"
		switch clean {
		case filepath.Join(data, "documents"):
		case filepath.Join(data, "imports"):
			id = "imports"
		default:
			id = fmt.Sprintf("legacy-%x", sha256.Sum256([]byte(base)))[:31]
			var mapped *string
			if filepath.IsAbs(clean) {
				if info, err := os.Stat(clean); err == nil && info.IsDir() {
					mapped = &clean
				}
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO storage_roots(id,label,path,managed,legacy_path) VALUES(?,?,?,0,?)`, id, filepath.Base(clean), mapped, base); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `UPDATE documents SET storage_root_id=?,basepath=NULL WHERE basepath=? AND filepath IS NOT NULL`, id, base); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE documents SET storage_root_id='library' WHERE filepath IS NOT NULL AND storage_root_id IS NULL`)
	return err
}

func upCanonicalStoragePaths(ctx context.Context, tx *sql.Tx) error {
	for _, column := range []string{"filepath", "coverfile"} {
		rows, err := tx.QueryContext(ctx, `SELECT id,`+column+` FROM documents WHERE instr('/' || `+column+` || '/', '/./') > 0`)
		if err != nil {
			return err
		}
		type update struct{ id, path string }
		var changes []update
		for rows.Next() {
			var id, name string
			if err := rows.Scan(&id, &name); err != nil {
				rows.Close()
				return err
			}
			if canonical, ok := storagepath.NormalizeLegacy(name); ok {
				changes = append(changes, update{id, canonical})
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		for _, change := range changes {
			if _, err := tx.ExecContext(ctx, `UPDATE documents SET `+column+`=? WHERE id=?`, change.path, change.id); err != nil {
				return err
			}
		}
	}
	return nil
}

const AutoImportRulesSchema = `CREATE TABLE IF NOT EXISTS auto_import_rules (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 root_id TEXT NOT NULL REFERENCES storage_roots(id) ON DELETE CASCADE,
 enabled BOOLEAN NOT NULL CHECK(enabled IN (0,1)),
 watch BOOLEAN NOT NULL CHECK(watch IN (0,1)),
 interval_minutes INTEGER NOT NULL CHECK(interval_minutes BETWEEN 1 AND 1440),
 reference BOOLEAN NOT NULL CHECK(reference IN (0,1)),
 last_scan TEXT,
 next_scan TEXT,
 status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','complete','errors','unavailable'))
);`

func upAutoImportRules(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, AutoImportRulesSchema)
	return err
}
