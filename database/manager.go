package database

import (
	"context"
	"database/sql"
	"embed"
	_ "embed"
	"fmt"
	"path/filepath"
	"time"

	"github.com/pressly/goose/v3"
	log "github.com/sirupsen/logrus"
	_ "modernc.org/sqlite"
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

//go:embed migrations/*
var migrations embed.FS

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
	if dbm.cfg.DBType == "sqlite" || dbm.cfg.DBType == "memory" {
		var dbLocation string = ":memory:"
		if dbm.cfg.DBType == "sqlite" {
			dbLocation = filepath.Join(dbm.cfg.ConfigPath, fmt.Sprintf("%s.db", dbm.cfg.DBName))
		}

		var err error
		dbm.DB, err = sql.Open("sqlite", dbLocation)
		if err != nil {
			log.Errorf("Unable to open DB: %v", err)
			return err
		}

		// Single Open Connection
		dbm.DB.SetMaxOpenConns(1)

		// Execute DDL
		if _, err := dbm.DB.Exec(ddl, nil); err != nil {
			log.Errorf("Error executing schema: %v", err)
			return err
		}

		// Perform Migrations
		err = dbm.performMigrations()
		if err != nil && err != goose.ErrNoMigrationFiles {
			log.Errorf("Error running DB migrations: %v", err)
			return err
		}

		// Set SQLite Settings (After Migrations)
		pragmaQuery := `
		  PRAGMA foreign_keys = ON;
		  PRAGMA journal_mode = WAL;
		`
		if _, err := dbm.DB.Exec(pragmaQuery, nil); err != nil {
			log.Errorf("Error executing pragma: %v", err)
			return err
		}

		// Cache Tables
		dbm.CacheTempTables()
	} else {
		return fmt.Errorf("unsupported database")
	}

	dbm.Queries = New(dbm.DB)

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

func (dbm *DBManager) performMigrations() error {
	// Set DB Migration
	goose.SetBaseFS(migrations)

	// Run Migrations
	goose.SetLogger(log.StandardLogger())
	goose.SetDialect("sqlite")
	return goose.Up(dbm.DB, "migrations")
}
