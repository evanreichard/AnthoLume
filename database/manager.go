package database

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"embed"
	_ "embed"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/pressly/goose/v3"
	log "github.com/sirupsen/logrus"
	sqlite "modernc.org/sqlite"
	"reichard.io/antholume/config"
	_ "reichard.io/antholume/database/migrations"
)

type DBManager struct {
	DB      *sql.DB
	Ctx     context.Context
	Queries *Queries
	cfg     *config.Config
}

//go:embed schema.sql
var ddl string

//go:embed views.sql
var views string

//go:embed migrations/*
var migrations embed.FS

// Register scalar sqlite function on init
func init() {
	sqlite.MustRegisterFunction("LOCAL_TIME", &sqlite.FunctionImpl{
		NArgs:         2,
		Deterministic: true,
		Scalar:        localTime,
	})
}

// Returns an initialized manager
func NewMgr(c *config.Config) *DBManager {
	// Create Manager
	dbm := &DBManager{
		Ctx: context.Background(),
		cfg: c,
	}

	if err := dbm.init(); err != nil {
		log.Panic("Unable to init DB")
	}

	return dbm
}

// Init manager
func (dbm *DBManager) init() error {
	// Build DB Location
	var dbLocation string
	switch dbm.cfg.DBType {
	case "sqlite":
		dbLocation = filepath.Join(dbm.cfg.ConfigPath, fmt.Sprintf("%s.db", dbm.cfg.DBName))
	case "memory":
		dbLocation = ":memory:"
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

	// Init SQLc
	dbm.Queries = New(dbm.DB)

	// Execute schema
	if _, err := dbm.DB.Exec(ddl, nil); err != nil {
		log.Panicf("Error executing schema: %v", err)
		return err
	}

	// Perform migrations
	err = dbm.performMigrations(isNew)
	if err != nil && err != goose.ErrNoMigrationFiles {
		log.Panicf("Error running DB migrations: %v", err)
		return err
	}

	// Execute views
	if _, err := dbm.DB.Exec(views, nil); err != nil {
		log.Panicf("Error executing views: %v", err)
		return err
	}

	// Update settings
	err = dbm.updateSettings()
	if err != nil {
		log.Panicf("Error running DB settings update: %v", err)
		return err
	}

	// Cache tables
	go dbm.CacheTempTables()

	return nil
}

// Reload manager (close DB & reinit)
func (dbm *DBManager) Reload() error {
	// Close handle
	err := dbm.DB.Close()
	if err != nil {
		return err
	}

	// Reinit DB
	if err := dbm.init(); err != nil {
		return err
	}

	return nil
}

func (dbm *DBManager) CacheTempTables() error {
	start := time.Now()
	user_streaks_sql := `
	  DELETE FROM user_streaks;
	  INSERT INTO user_streaks SELECT * FROM view_user_streaks;
	`
	if _, err := dbm.DB.ExecContext(dbm.Ctx, user_streaks_sql); err != nil {
		return err
	}
	log.Debug("Cached 'user_streaks' in: ", time.Since(start))

	start = time.Now()
	document_statistics_sql := `
	  DELETE FROM document_user_statistics;
	  INSERT INTO document_user_statistics SELECT * FROM view_document_user_statistics;
	`
	if _, err := dbm.DB.ExecContext(dbm.Ctx, document_statistics_sql); err != nil {
		return err
	}
	log.Debug("Cached 'document_user_statistics' in: ", time.Since(start))

	return nil
}

func (dbm *DBManager) updateSettings() error {
	// Set SQLite PRAGMA Settings
	pragmaQuery := `
		  PRAGMA foreign_keys = ON;
		  PRAGMA journal_mode = WAL;
		`
	if _, err := dbm.DB.Exec(pragmaQuery, nil); err != nil {
		log.Errorf("Error executing pragma: %v", err)
		return err
	}

	// Update Antholume Version in DB
	if _, err := dbm.Queries.UpdateSettings(dbm.Ctx, UpdateSettingsParams{
		Name:  "version",
		Value: dbm.cfg.Version,
	}); err != nil {
		log.Errorf("Error updating DB settings: %v", err)
		return err
	}

	return nil
}

func (dbm *DBManager) performMigrations(isNew bool) error {
	// Create context
	ctx := context.WithValue(context.Background(), "isNew", isNew)

	// Set DB migration
	goose.SetBaseFS(migrations)

	// Run migrations
	goose.SetLogger(log.StandardLogger())
	if err := goose.SetDialect("sqlite"); err != nil {
		return err
	}

	return goose.UpContext(ctx, dbm.DB, "migrations")
}

// Determines whether the database is empty
func isEmpty(db *sql.DB) (bool, error) {
	var tableCount int
	err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table';").Scan(&tableCount)
	if err != nil {
		return false, err
	}
	return tableCount == 0, nil
}

// LOCAL_TIME custom SQL function
func localTime(ctx *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
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

	return formattedTime.In(timeZone).Format("2006-01-02 15:04:05.000"), nil
}
