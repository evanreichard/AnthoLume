package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() { goose.AddMigrationContext(upAdminJobs, downAdminJobs) }

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

func downAdminJobs(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `DROP TABLE admin_jobs`)
	return err
}
