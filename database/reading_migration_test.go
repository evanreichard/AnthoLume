package database

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
	dbmigrations "reichard.io/antholume/database/migrations"
)

func openPreReactDatabase(t *testing.T, cfg *config.Config) *DBManager {
	t.Helper()
	// Remove only the storage additions to the base DDL; master has none of the embedded extensions.
	before, after, ok := strings.Cut(ddl, "-- Document storage\n")
	require.True(t, ok)
	_, after, ok = strings.Cut(after, "-- Books / Documents\n")
	require.True(t, ok)
	legacyDDL := before + "-- Books / Documents\n" + strings.Replace(after, ",\n    storage_root_id TEXT REFERENCES storage_roots (id)", "", 1)
	db, err := sql.Open("sqlite", filepath.Join(cfg.ConfigPath, cfg.DBName+".db"))
	require.NoError(t, err)
	db.SetMaxOpenConns(1)
	require.NoError(t, db.Ping())
	mgr := &DBManager{DB: db, cfg: cfg}
	t.Cleanup(func() { require.NoError(t, mgr.DB.Close()) })
	_, err = db.Exec(legacyDDL)
	require.NoError(t, err)
	// The legacy base DDL already includes the effects of the three migration versions.
	goose.SetBaseFS(migrations)
	require.NoError(t, goose.SetDialect("sqlite"))
	ctx := context.WithValue(context.Background(), "isNew", true) // nolint
	require.NoError(t, goose.UpToContext(ctx, db, "migrations", 20240510123707))
	return mgr
}

func TestReadingAdditiveMigrationPreservesHistoricalRowsAndOrphans(t *testing.T) {
	root := t.TempDir()
	cfg := &config.Config{DBType: "sqlite", DBName: "populated", ConfigPath: root, DataPath: filepath.Join(root, "data"), Version: "test"}
	db := openPreReactDatabase(t, cfg)
	exec := func(query string, args ...any) {
		t.Helper()
		_, err := db.DB.Exec(query, args...)
		require.NoError(t, err)
	}
	exec(`INSERT INTO users(id,pass,auth_hash) VALUES('alice','synthetic','hash')`)
	external := filepath.Join(root, "external-library")
	exec(`INSERT INTO documents(id,title,basepath,filepath) VALUES('tie','Untouched title',?,'./original.epub'),('older','Older',NULL,NULL),('empty',NULL,NULL,NULL),('docker-book','Docker book','/data/documents','./book.epub')`, external)
	exec(`INSERT INTO devices(id,user_id,device_name) VALUES('device-b','alice','B'),('device-a','alice','A')`)
	exec(`INSERT INTO document_progress(user_id,document_id,device_id,percentage,progress,created_at) VALUES
 ('alice','tie','device-b',0.99,'B exact position','2026-01-01T00:00:00Z'),
 ('alice','tie','device-a',0.1,'A exact position','2026-01-01T00:00:00Z'),
 ('alice','older','device-b',0.9,'old later position','2026-01-02T00:00:00Z'),
 ('alice','older','device-a',0.8,'old earlier position','2026-01-01T00:00:00Z')`)
	exec(`INSERT INTO activity(user_id,document_id,device_id,start_time,duration,start_percentage,end_percentage) VALUES('alice','tie','device-a','2026-01-01T00:00:00Z',10,0.1,0.2)`)
	exec(`PRAGMA foreign_keys=OFF; INSERT INTO metadata(document_id,title) VALUES('orphan-one','original one'),('orphan-two','original two'); PRAGMA foreign_keys=ON;`)
	snapshot := func() string {
		var value string
		require.NoError(t, db.DB.QueryRow(`SELECT json_group_array(json_array(user_id,document_id,device_id,percentage,progress,created_at)) FROM (SELECT * FROM document_progress ORDER BY document_id,device_id)`).Scan(&value))
		return value
	}
	before := snapshot()
	require.NoError(t, db.Reload(context.Background()))
	require.Equal(t, before, snapshot())
	var revision int64
	var position, device, basepath string
	var fraction float64
	require.NoError(t, db.DB.QueryRow(`SELECT revision,position,fraction,device_id FROM reading_heads WHERE document_id='tie'`).Scan(&revision, &position, &fraction, &device))
	require.Zero(t, revision)
	require.Equal(t, "A exact position", position)
	require.Equal(t, 0.1, fraction)
	require.Equal(t, "device-a", device)
	require.NoError(t, db.DB.QueryRow(`SELECT position FROM reading_heads WHERE document_id='older'`).Scan(&position))
	require.Equal(t, "old later position", position)
	require.NoError(t, db.DB.QueryRow(`SELECT r.legacy_path FROM documents d JOIN storage_roots r ON r.id=d.storage_root_id WHERE d.id='tie'`).Scan(&basepath))
	require.Equal(t, external, basepath)
	var file string
	require.NoError(t, db.DB.QueryRow(`SELECT filepath FROM documents WHERE id='tie'`).Scan(&file))
	require.Equal(t, "original.epub", file)
	var rootID string
	require.NoError(t, db.DB.QueryRow(`SELECT storage_root_id,filepath FROM documents WHERE id='docker-book'`).Scan(&rootID, &file))
	require.NotEqual(t, "library", rootID)
	require.Equal(t, "book.epub", file)
	var metadata, activity, heads int
	require.NoError(t, db.DB.QueryRow("SELECT count(*) FROM metadata").Scan(&metadata))
	require.Equal(t, 2, metadata)
	require.NoError(t, db.DB.QueryRow("SELECT count(*) FROM activity").Scan(&activity))
	require.Equal(t, 1, activity)
	require.NoError(t, db.DB.QueryRow("SELECT count(*) FROM reading_heads").Scan(&heads))
	require.Equal(t, 2, heads)
	rows, err := db.DB.Query("PRAGMA foreign_key_check")
	require.NoError(t, err)
	orphans := 0
	for rows.Next() {
		var table, parent string
		var row, fk int
		require.NoError(t, rows.Scan(&table, &row, &parent, &fk))
		require.Equal(t, "metadata", table)
		orphans++
	}
	require.NoError(t, rows.Err())
	rows.Close()
	require.Equal(t, 2, orphans)
	exec("UPDATE reading_heads SET revision=7,position='accepted backward state',fraction=0.01 WHERE document_id='tie'")
	require.NoError(t, db.Reload(context.Background()))
	require.NoError(t, db.DB.QueryRow(`SELECT revision,position FROM reading_heads WHERE document_id='tie'`).Scan(&revision, &position))
	require.Equal(t, int64(7), revision)
	require.Equal(t, "accepted backward state", position)
	require.Equal(t, before, snapshot())
	// The schema extension is the same source used by Goose and may be executed repeatedly without rewriting data.
	exec(dbmigrations.ReadingSchema)
	require.Equal(t, before, snapshot())
	require.ErrorContains(t, goose.DownToContext(context.Background(), db.DB, "migrations", 20240510123707), "downgrade is unsafe")
}

func TestReadingSchemaDeletionAndRevisionBounds(t *testing.T) {
	cfg := &config.Config{DBType: "memory", Version: "test"}
	db := NewMgr(cfg)
	defer db.DB.Close()
	_, err := db.DB.Exec(`INSERT INTO users(id,pass,auth_hash) VALUES('a','p','h'); INSERT INTO documents(id) VALUES('d');
 INSERT INTO reading_heads(user_id,document_id,revision,position) VALUES('a','d',0,'x');
 INSERT INTO reading_receipts(user_id,event_id,document_id,kind,payload_version,payload,digest,observed_at,status,code) VALUES('a','e','d','activity',1,'{}','digest','2026-01-01T00:00:00Z',200,'');`)
	require.NoError(t, err)
	_, err = db.DB.Exec("UPDATE reading_heads SET revision=1000000000000000000")
	require.Error(t, err)
	_, err = db.DB.Exec("UPDATE documents SET deleted=1 WHERE id='d'")
	require.NoError(t, err)
	var n int
	require.NoError(t, db.DB.QueryRow("SELECT count(*) FROM reading_heads").Scan(&n))
	require.Zero(t, n)
	require.NoError(t, db.DB.QueryRow("SELECT count(*) FROM reading_receipts").Scan(&n))
	require.Zero(t, n)
	_, err = db.DB.Exec("UPDATE documents SET deleted=0 WHERE id='d'; INSERT INTO reading_heads(user_id,document_id) VALUES('a','d'); DELETE FROM users WHERE id='a'")
	require.NoError(t, err)
	require.NoError(t, db.DB.QueryRow("SELECT count(*) FROM reading_heads").Scan(&n))
	require.Zero(t, n)
	var integrity string
	require.NoError(t, db.DB.QueryRow("PRAGMA integrity_check").Scan(&integrity))
	require.Equal(t, "ok", integrity)
	var version int64
	require.NoError(t, db.DB.QueryRow("SELECT version_id FROM goose_db_version WHERE version_id=20261126000000 AND is_applied=1").Scan(&version))
	require.Equal(t, int64(20261126000000), version)
}
