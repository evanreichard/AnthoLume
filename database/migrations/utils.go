package migrations

import (
	"database/sql"
	"fmt"
)

type columnInfo struct {
	CID        int
	Name       string
	Type       string
	NotNull    int
	DefaultVal sql.NullString
	PK         int
}

func hasColumn(tx *sql.Tx, table string, column string) (bool, error) {
	rows, err := tx.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	colExists := false
	for rows.Next() {
		var col columnInfo
		if err := rows.Scan(&col.CID, &col.Name, &col.Type, &col.NotNull, &col.DefaultVal, &col.PK); err != nil {
			return false, err
		}

		if col.Name == column {
			colExists = true
			break
		}
	}

	return colExists, nil
}
