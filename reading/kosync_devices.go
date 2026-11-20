package reading

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"reichard.io/antholume/database"
)

func (s *Store) KOLastActivity(ctx context.Context, user, id, name string) (int64, error) {
	if err := s.RegisterDevice(ctx, user, id, name); err != nil {
		return 0, err
	}
	value, err := database.New(s.DB).GetLastActivity(ctx, database.GetLastActivityParams{UserID: user, DeviceID: id})
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	stamp, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return 0, err
	}
	return stamp.Unix(), nil
}
