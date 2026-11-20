package migrations

import (
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"

	"github.com/pressly/goose/v3"
	"reichard.io/antholume/pkg/storagepath"
)

//go:embed schema/admin_jobs_schema.sql
var adminJobsSchema string

//go:embed schema/account_identities_schema.sql
var accountIdentitiesSchema string

//go:embed schema/reading_generation_schema.sql
var readingGenerationSchema string

func init() { goose.AddMigrationContext(upReactUpgrade, downReactUpgrade) }

func upReactUpgrade(ctx context.Context, tx *sql.Tx) error {
	for _, step := range []func(context.Context, *sql.Tx) error{
		upReading, upKOSyncDevices, upDevicePreferences,
		upStorageRoots, upCanonicalStoragePaths,
	} {
		if err := step(ctx, tx); err != nil {
			return err
		}
	}
	for _, schema := range []string{adminJobsSchema, AutoImportRulesSchema, accountIdentitiesSchema, readingGenerationSchema} {
		if _, err := tx.ExecContext(ctx, schema); err != nil {
			return err
		}
	}
	return nil
}

func downReactUpgrade(context.Context, *sql.Tx) error {
	return fmt.Errorf("reading ledger downgrade is unsafe; restore a compatible backup with writes stopped")
}

// ReadingSchema is shared by fresh schema initialization and the additive upgrade.
//
//go:embed schema/reading_schema.sql
var ReadingSchema string

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

//go:embed schema/kosync_device_schema.sql
var KOSyncDeviceSchema string

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
//
//go:embed schema/device_preferences_schema.sql
var DevicePreferencesSchema string

func upDevicePreferences(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, DevicePreferencesSchema)
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
		// Legacy Relative Paths - The old server opened relative base paths from its working directory.
		resolved, err := filepath.Abs(base)
		if err != nil {
			return err
		}
		id := "library"
		switch resolved {
		case filepath.Join(data, "documents"):
		case filepath.Join(data, "imports"):
			id = "imports"
		default:
			id = fmt.Sprintf("legacy-%x", sha256.Sum256([]byte(base)))[:31]
			var mapped *string
			if info, err := os.Stat(resolved); err == nil && info.IsDir() {
				mapped = &resolved
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO storage_roots(id,label,path,managed,legacy_path) VALUES(?,?,?,0,?)`, id, filepath.Base(resolved), mapped, base); err != nil {
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

//go:embed schema/auto_import_rules_schema.sql
var AutoImportRulesSchema string
