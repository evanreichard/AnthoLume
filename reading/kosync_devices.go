package reading

import (
	"context"
	"database/sql"
	"errors"
	"unicode/utf8"

	"github.com/google/uuid"
	"reichard.io/antholume/database"
)

func koDevice(ctx context.Context, q *database.Queries, user string, externalID *string, name string) (string, error) {
	external := ""
	if externalID != nil {
		external = *externalID
	}
	if external != "" && !validID(external) || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 128 {
		return "", fail(400, "invalid_request")
	}
	internal, err := q.GetKOSyncDeviceAlias(ctx, database.GetKOSyncDeviceAliasParams{UserID: user, ExternalID: external})
	if err == nil {
		return internal, register(ctx, q, user, internal, name)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	internal = external
	if internal != "" {
		owner, err := q.GetDeviceOwner(ctx, internal)
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
			n, err := q.InsertKOSyncDeviceIfFree(ctx, database.InsertKOSyncDeviceIfFreeParams{
				ID: internal, UserID: user, DeviceName: name,
			})
			if err != nil {
				return "", err
			}
			if n == 1 {
				break
			}
		}
	} else if err := register(ctx, q, user, internal, name); err != nil {
		return "", err
	}
	err = q.InsertKOSyncDeviceAlias(ctx, database.InsertKOSyncDeviceAliasParams{
		UserID: user, ExternalID: external, DeviceID: internal,
	})
	return internal, err
}
