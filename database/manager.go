package database

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"embed"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/pressly/goose/v3"
	log "github.com/sirupsen/logrus"
	sqlite "modernc.org/sqlite"
	"reichard.io/antholume/config"
	dbmigrations "reichard.io/antholume/database/migrations"
)

type DBManager struct {
	DB      *sql.DB
	Queries *Queries
	cfg     *config.Config
}

//go:embed schema.sql
var ddl string

//go:embed document_user_statistics.sql
var document_user_statistics string

//go:embed migrations/*
var migrations embed.FS

// Register scalar sqlite function on init
func init() {
	sqlite.MustRegisterFunction("READING_WRITER", &sqlite.FunctionImpl{NArgs: 0, Deterministic: true, Scalar: func(*sqlite.FunctionContext, []driver.Value) (driver.Value, error) { return int64(1), nil }})
	sqlite.MustRegisterFunction("LOCAL_DATE", &sqlite.FunctionImpl{
		NArgs:         2,
		Deterministic: true,
		Scalar:        localDate,
	})
}

// NewMgr Returns an initialized manager
func NewMgr(c *config.Config) *DBManager {
	// Create Manager
	dbm := &DBManager{cfg: c}

	if err := dbm.init(context.Background()); err != nil {
		log.Panic("Unable to init DB")
	}

	return dbm
}

// init loads the DB manager
func (dbm *DBManager) init(ctx context.Context) error {
	// Build DB Location
	const writerPragmas = "_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)&_pragma=synchronous(FULL)"
	var dbLocation string
	switch dbm.cfg.DBType {
	case "sqlite":
		path, err := filepath.Abs(filepath.Join(dbm.cfg.ConfigPath, dbm.cfg.DBName+".db"))
		if err != nil {
			return err
		}
		dbLocation = (&url.URL{Scheme: "file", Path: path}).String()
	case "memory":
		dbLocation = ":memory:?" + writerPragmas
	default:
		return fmt.Errorf("unsupported database")
	}

	var err error
	dbm.DB, err = sql.Open("sqlite", dbLocation)
	if err != nil {
		log.Panicf("Unable to open DB: %v", err)
		return err
	}

	// Single open connection
	dbm.DB.SetMaxOpenConns(1)

	// Check if DB is new
	isNew, err := isEmpty(dbm.DB)
	if err != nil {
		log.Panicf("Unable to determine db info: %v", err)
		return err
	}

	// Execute schema
	if _, err := dbm.DB.Exec(ddl + dbmigrations.ReadingSchema); err != nil {
		log.Panicf("Error executing schema: %v", err)
		return err
	}

	// In-Memory Bootstrap - Keep the same connection while rebuilding the fresh schema.
	if dbm.cfg.DBType == "memory" {
		if _, err := dbm.DB.ExecContext(ctx, `PRAGMA foreign_keys=OFF`); err != nil {
			return err
		}
	}
	if err := migrate(dbmigrations.WithStorageDataPath(ctx, dbm.cfg.DataPath), dbm.DB, isNew); err != nil && err != goose.ErrNoMigrationFiles {
		log.Panicf("Error running DB migrations: %v", err)
		return err
	}

	// Startup Migrations - Historical table rebuilds require foreign keys off; the runtime DSN enables them on every writer connection.
	if dbm.cfg.DBType == "sqlite" {
		if err := dbm.DB.Close(); err != nil {
			return err
		}
		dbm.DB, err = sql.Open("sqlite", dbLocation+"?"+writerPragmas)
		if err != nil {
			return err
		}
		dbm.DB.SetMaxOpenConns(1)
	}
	dbm.Queries = New(dbm.DB)

	err = dbm.updateSettings(ctx)
	if err != nil {
		log.Panicf("Error running DB settings update: %v", err)
		return err
	}

	if err := dbm.CacheTempTables(ctx); err != nil {
		log.Warn("Refreshing document user statistics failed: ", err)
	}

	return nil
}

// BackupSnapshot uses a separate WAL reader so copying database pages does not occupy the request connection.
func (dbm *DBManager) BackupSnapshot(ctx context.Context, dest string) error {
	if dbm.cfg.DBType == "memory" {
		_, err := dbm.DB.ExecContext(ctx, `VACUUM INTO ?`, dest)
		return err
	}
	path, err := filepath.Abs(filepath.Join(dbm.cfg.ConfigPath, dbm.cfg.DBName+".db"))
	if err != nil {
		return err
	}
	uri := (&url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro&_pragma=busy_timeout(5000)"}).String()
	source, err := sql.Open("sqlite", uri)
	if err != nil {
		return err
	}
	defer source.Close()
	_, err = source.ExecContext(ctx, `VACUUM INTO ?`, dest)
	return err
}

// PortableBackupSnapshot compacts a private copy after deleting deployment-local links.
func (dbm *DBManager) PortableBackupSnapshot(ctx context.Context, dest string) error {
	dir, err := os.MkdirTemp(filepath.Dir(dest), ".redact-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	name := filepath.Join(dir, "snapshot.db")
	if err := dbm.BackupSnapshot(ctx, name); err != nil {
		return err
	}
	uri := (&url.URL{Scheme: "file", Path: name, RawQuery: "mode=rw&_pragma=journal_mode(DELETE)"}).String()
	snapshot, err := sql.Open("sqlite", uri)
	if err != nil {
		return err
	}
	defer snapshot.Close()
	result, err := snapshot.ExecContext(ctx, `DELETE FROM hardcover_links`)
	if err != nil {
		return err
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if deleted == 0 {
		return os.Rename(name, dest)
	}
	// Rebuild From Live Rows - Deletion alone can leave ciphertext on SQLite's free pages.
	_, err = snapshot.ExecContext(ctx, `VACUUM INTO ?`, dest)
	return err
}

// Reload closes the DB & reinits
func (dbm *DBManager) Reload(ctx context.Context) error {
	// Close handle
	err := dbm.DB.Close()
	if err != nil {
		return err
	}

	// Reinit DB
	if err := dbm.init(ctx); err != nil {
		return err
	}

	return nil
}

// CacheTempTables refreshes the document user statistics projection.
func (dbm *DBManager) CacheTempTables(ctx context.Context) error {
	_, err := dbm.DB.ExecContext(ctx, document_user_statistics)
	return err
}

func (dbm *DBManager) updateSettings(ctx context.Context) error {
	if _, err := dbm.DB.ExecContext(ctx, `PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL`); err != nil {
		log.Errorf("Error executing pragma: %v", err)
		return err
	}

	// Update Antholume Version in DB
	if _, err := dbm.Queries.UpdateSettings(ctx, UpdateSettingsParams{
		Name:  "version",
		Value: dbm.cfg.Version,
	}); err != nil {
		log.Errorf("Error updating DB settings: %v", err)
		return err
	}

	return nil
}

// isEmpty determines whether the database is empty
func isEmpty(db *sql.DB) (bool, error) {
	var tableCount int
	err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table';").Scan(&tableCount)
	if err != nil {
		return false, err
	}
	return tableCount == 0, nil
}

// localDate is a custom SQL function that is registered as LOCAL_DATE in the init function
func localDate(ctx *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
	timeStr, ok := args[0].(string)
	if !ok {
		return nil, errors.New("both arguments to TZTime must be strings")
	}

	timeZoneStr, ok := args[1].(string)
	if !ok {
		return nil, errors.New("both arguments to TZTime must be strings")
	}

	timeZone, err := time.LoadLocation(timeZoneStr)
	if err != nil {
		return nil, errors.New("unable to parse timezone")
	}

	formattedTime, err := time.ParseInLocation(time.RFC3339, timeStr, time.UTC)
	if err != nil {
		return nil, errors.New("unable to parse time")
	}

	return formattedTime.In(timeZone).Format("2006-01-02"), nil
}
