package database

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	log "github.com/sirupsen/logrus"
	_ "modernc.org/sqlite"
	"path"
	"reichard.io/bbank/config"
)

type DBManager struct {
	DB      *sql.DB
	Ctx     context.Context
	Queries *Queries
}

//go:embed schema.sql
var ddl string

//go:embed update_temp_tables.sql
var tsql string

func NewMgr(c *config.Config) *DBManager {
	// Create Manager
	dbm := &DBManager{
		Ctx: context.Background(),
	}

	// Create Database
	if c.DBType == "sqlite" || c.DBType == "memory" {
		var dbLocation string = ":memory:"
		if c.DBType == "sqlite" {
			dbLocation = path.Join(c.ConfigPath, fmt.Sprintf("%s.db", c.DBName))
		}

		var err error
		dbm.DB, err = sql.Open("sqlite", dbLocation)
		if err != nil {
			log.Fatal(err)
		}

		// Single Open Connection
		dbm.DB.SetMaxOpenConns(1)
		if _, err := dbm.DB.Exec(ddl, nil); err != nil {
			log.Info("Exec Error:", err)
		}
	} else {
		log.Fatal("Unsupported Database")
	}

	dbm.Queries = New(dbm.DB)

	return dbm
}

func (dbm *DBManager) CacheTempTables() error {
	if _, err := dbm.DB.ExecContext(dbm.Ctx, tsql); err != nil {
		return err
	}
	return nil
}
