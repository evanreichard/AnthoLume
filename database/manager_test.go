package database

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"reichard.io/antholume/config"
)

func TestCacheRefreshLeavesLegacyStreaksForAccountDeletion(t *testing.T) {
	ctx := context.Background()
	mgr := NewMgr(&config.Config{DBType: "memory"})
	db := mgr.DB
	t.Cleanup(func() { require.NoError(t, db.Close()) })

	const userID, documentID, deviceID = "testUser", "testDocument", "testDevice"
	_, err := db.Exec(`INSERT INTO users (id, pass, auth_hash) VALUES (?, 'unused', 'unused')`, userID)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO documents (id) VALUES (?)`, documentID)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO devices (id, user_id, device_name) VALUES (?, ?, 'Test device')`, deviceID, userID)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO user_streaks VALUES (?, 'DAY', 9, '2026-01-01', '2026-01-09', 9,
		'2026-01-01', '2026-01-09', 'UTC', '2026-01-10T00:00:00Z', '2026-01-09T00:00:00Z', '2026-01-10T00:00:00Z')`, userID)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO activity (user_id, document_id, device_id, start_time, duration, start_percentage, end_percentage)
		VALUES (?, ?, ?, '2026-02-01T00:00:00Z', 60, 0, 0.1)`, userID, documentID, deviceID)
	require.NoError(t, err)
	require.NoError(t, mgr.CacheTempTables(ctx))

	var seconds int64
	require.NoError(t, db.QueryRow(`SELECT total_time_seconds FROM document_user_statistics WHERE user_id = ? AND document_id = ?`, userID, documentID).Scan(&seconds))
	require.Equal(t, int64(60), seconds)
	var streaks string
	require.NoError(t, db.QueryRow(`SELECT group_concat(window || ':' || max_streak) FROM user_streaks WHERE user_id = ?`, userID).Scan(&streaks))
	require.Equal(t, "DAY:9", streaks)

	require.NoError(t, mgr.Queries.DeleteAdminUserStreaks(ctx, userID))
	var count int
	require.NoError(t, db.QueryRow(`SELECT count(*) FROM user_streaks WHERE user_id = ?`, userID).Scan(&count))
	require.Zero(t, count)
}
