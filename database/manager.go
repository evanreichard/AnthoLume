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

	// Create Tables
	if _, err := dbm.DB.ExecContext(dbm.Ctx, ddl); err != nil {
		log.Fatal(err)
	}

	dbm.Queries = New(dbm.DB)

	return dbm
}

func connectHookSQLite(conn *sqlite.SQLiteConn) error {
	if err := conn.RegisterFunc("test_func", func() string {
		return "FOOBAR"
	}, false); err != nil {
		log.Info("Error Registering Function")
		return err
	}
	return nil
}
