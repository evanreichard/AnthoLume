package database

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"path"

	sqlite "github.com/mattn/go-sqlite3"
	log "github.com/sirupsen/logrus"
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
	if c.DBType == "sqlite" {
		sql.Register("sqlite3_custom", &sqlite.SQLiteDriver{
			ConnectHook: connectHookSQLite,
		})

		dbLocation := path.Join(c.ConfigPath, fmt.Sprintf("%s.db", c.DBName))

		var err error
		dbm.DB, err = sql.Open("sqlite3_custom", dbLocation)
		if err != nil {
			log.Fatal(err)
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

func connectHookSQLite(conn *sqlite.SQLiteConn) error {
	// Create Tables
	log.Debug("Creating Schema")
	if _, err := conn.Exec(ddl, nil); err != nil {
		log.Warn("Create Schema Failure: ", err)
	}
	return nil
}
