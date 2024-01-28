package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/pressly/goose/v3"
	"reichard.io/antholume/utils"
)

func init() {
	goose.AddMigrationContext(upUserAuthHash, downUserAuthHash)
}

func upUserAuthHash(ctx context.Context, tx *sql.Tx) error {
	// Validate column doesn't already exist
	hasCol, err := hasColumn(tx, "users", "auth_hash")
	if err != nil {
		return err
	} else if hasCol {
		return nil
	}

	// Copy table & create column
	_, err = tx.Exec(`
	  -- Create Copy Table
	  CREATE TABLE temp_users AS SELECT * FROM users;
	  ALTER TABLE temp_users ADD COLUMN auth_hash TEXT;

	  -- Update Schema
	  DELETE FROM users;
	  ALTER TABLE users ADD COLUMN auth_hash TEXT NOT NULL;
	`)
	if err != nil {
		return err
	}

	// Get current users
	rows, err := tx.Query("SELECT id FROM temp_users")
	if err != nil {
		return err
	}

	// Query existing users
	var users []string
	for rows.Next() {
		var user string
		if err := rows.Scan(&user); err != nil {
			return err
		}
		users = append(users, user)
	}

	// Create auth hash per user
	for _, user := range users {
		rawAuthHash, err := utils.GenerateToken(64)
		if err != nil {
			return err
		}

		authHash := fmt.Sprintf("%x", rawAuthHash)
		_, err = tx.Exec("UPDATE temp_users SET auth_hash = ? WHERE id = ?", authHash, user)
		if err != nil {
			return err
		}
	}

	// Copy from temp to true table
	_, err = tx.Exec(`
	  -- Copy Into New
	  INSERT INTO users SELECT * FROM temp_users;

	  -- Drop Temp Table
	  DROP TABLE temp_users;
	`)
	if err != nil {
		return err
	}

	return nil
}

func downUserAuthHash(ctx context.Context, tx *sql.Tx) error {
	// Drop column
	_, err := tx.Exec("ALTER users DROP COLUMN auth_hash")
	if err != nil {
		return err
	}
	return nil
}
