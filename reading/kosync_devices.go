package reading

import (
	"context"
	"database/sql"
	"errors"
	"unicode/utf8"

	"github.com/google/uuid"
)

func koDevice(ctx context.Context, tx *sql.Tx, user string, externalID *string, name string) (string, error) {
	external := ""
	if externalID != nil {
		external = *externalID
	}
	if external != "" && !validID(external) || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 128 {
		return "", fail(400, "invalid_request")
	}
	var internal string
	err := tx.QueryRowContext(ctx, `SELECT device_id FROM kosync_device_aliases WHERE user_id=? AND external_id=?`, user, external).Scan(&internal)
	if err == nil {
		return internal, register(ctx, tx, user, internal, name)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	internal = external
	if internal != "" {
		var owner string
		err = tx.QueryRowContext(ctx, "SELECT user_id FROM devices WHERE id=?", internal).Scan(&owner)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		if err == nil && owner != user {
			internal = ""
		}
	}
	if internal == "" {
		// Internal Identity - Never upsert a random collision or expose this server-generated ID as the external ID.
		for {
			internal = uuid.NewString()
			result, err := tx.ExecContext(ctx, `INSERT INTO devices(id,user_id,device_name) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING`, internal, user, name)
			if err != nil {
				return "", err
			}
			n, err := result.RowsAffected()
			if err != nil {
				return "", err
			}
			if n == 1 {
				break
			}
		}
	} else if err := register(ctx, tx, user, internal, name); err != nil {
		return "", err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO kosync_device_aliases(user_id,external_id,device_id) VALUES(?,?,?)`, user, external, internal)
	return internal, err
}
