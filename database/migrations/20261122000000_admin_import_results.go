package migrations

import (
	"context"
	"database/sql"
	"github.com/pressly/goose/v3"
)

func init() { goose.AddMigrationContext(upAdminImportResults, downAdminImportResults) }
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
func downAdminImportResults(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `ALTER TABLE admin_jobs DROP COLUMN result`)
	return err
}
