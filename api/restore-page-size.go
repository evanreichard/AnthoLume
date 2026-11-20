package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
)

func (api *API) normalizeRestorePageSize(ctx context.Context, name string) error {
	var target int
	if err := api.db.DB.QueryRowContext(ctx, `PRAGMA page_size`).Scan(&target); err != nil {
		return err
	}
	uri := (&url.URL{Scheme: "file", Path: name, RawQuery: "mode=rw&_pragma=trusted_schema(OFF)"}).String()
	db, err := sql.Open("sqlite", uri)
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	var size int
	if err := db.QueryRowContext(ctx, `PRAGMA page_size`).Scan(&size); err != nil || size == target {
		return err
	}
	dir, err := os.MkdirTemp(filepath.Dir(name), "repage-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	copy := filepath.Join(dir, adminBackupName)
	// SQLite Page Size - VACUUM cannot change the page size of a database in WAL mode.
	var mode string
	if err := db.QueryRowContext(ctx, `PRAGMA journal_mode=DELETE`).Scan(&mode); err != nil {
		return err
	}
	if mode != "delete" {
		return errors.New("could not disable WAL on staged snapshot")
	}
	if _, err := db.ExecContext(ctx, fmt.Sprintf("PRAGMA page_size=%d", target)); err != nil {
		return err
	}
	if _, err := db.ExecContext(ctx, `VACUUM INTO ?`, copy); err != nil {
		return err
	}
	if err := db.Close(); err != nil {
		return err
	}
	if err := api.validateRestoreDB(ctx, copy); err != nil {
		return err
	}
	if err := api.checkRestorePageSize(ctx, copy); err != nil {
		return err
	}
	return os.Rename(copy, name)
}

func (api *API) checkRestorePageSize(ctx context.Context, name string) error {
	db, err := sql.Open("sqlite", snapshotURI(name))
	if err != nil {
		return err
	}
	defer db.Close()
	var source, dest int
	if err := db.QueryRowContext(ctx, `PRAGMA page_size`).Scan(&source); err != nil {
		return err
	}
	if err := api.db.DB.QueryRowContext(ctx, `PRAGMA page_size`).Scan(&dest); err != nil {
		return err
	}
	if source != dest {
		return errors.New("snapshot page size differs from the live database")
	}
	return nil
}
