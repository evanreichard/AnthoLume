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
)

type DBManager struct {
	DB      *sql.DB
	Ctx     context.Context
	Queries *Queries
}

//go:embed schema.sql
var ddl string

//go:embed migrations/*
var migrations embed.FS

func NewMgr(c *config.Config) *DBManager {
	// Create Manager
	dbm := &DBManager{
		Ctx: context.Background(),
	}

	// Create Database
	if c.DBType == "sqlite" || c.DBType == "memory" {
		var dbLocation string = ":memory:"
		if c.DBType == "sqlite" {
			dbLocation = filepath.Join(c.ConfigPath, fmt.Sprintf("%s.db", c.DBName))
		}

		var err error
		dbm.DB, err = sql.Open("sqlite", dbLocation)
		if err != nil {
			log.Fatalf("Unable to open DB: %v", err)
		}

		// Single Open Connection
		dbm.DB.SetMaxOpenConns(1)

		// Execute DDL
		if _, err := dbm.DB.Exec(ddl, nil); err != nil {
			log.Fatalf("Error executing schema: %v", err)
		}

		// Perform Migrations
		err = dbm.performMigrations()
		if err != nil && err != goose.ErrNoMigrationFiles {
			log.Fatalf("Error running DB migrations: %v", err)
		}

		// Cache Tables
		dbm.CacheTempTables()
	} else {
		log.Fatal("Unsupported Database")
	}

	dbm.Queries = New(dbm.DB)

	return dbm
}

func (dbm *DBManager) Shutdown() error {
	return dbm.DB.Close()
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
