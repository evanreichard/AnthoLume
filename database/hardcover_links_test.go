package database

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
)

func TestHardcoverLinksCascadeOnReopenedWriter(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	db := NewMgr(&config.Config{DBType: "sqlite", DBName: "live", ConfigPath: dir, DataPath: dir})
	defer db.DB.Close()
	_, err := db.DB.Exec(`INSERT INTO users(id,pass,auth_hash) VALUES ('reader','pass','hash');
INSERT INTO hardcover_links SELECT account_id, X'0123' FROM account_identities WHERE user_id='reader';`)
	require.NoError(t, err)

	// Force database/sql to discard the pooled connection, not just return it.
	db.DB.SetMaxIdleConns(0)
	tx, err := db.DB.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `DELETE FROM users WHERE id='reader'`)
	require.NoError(t, err)
	var links int
	require.NoError(t, tx.QueryRowContext(ctx, `SELECT count(*) FROM hardcover_links`).Scan(&links))
	require.Zero(t, links)
	require.NoError(t, tx.Rollback())
	require.NoError(t, db.DB.QueryRow(`SELECT count(*) FROM hardcover_links`).Scan(&links))
	require.Equal(t, 1, links)
	_, err = db.DB.Exec(`DELETE FROM users WHERE id='reader'`)
	require.NoError(t, err)
	require.NoError(t, db.DB.QueryRow(`SELECT count(*) FROM hardcover_links`).Scan(&links))
	require.Zero(t, links)
}
