package api

import (
	"context"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestStatisticsFollowSharedBackwardHeadWithoutRewritingCredit(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	f.exec("UPDATE documents SET words=10000 WHERE id='book-a'")
	require.Equal(t, 200, f.koWrite("book-a", "ko", 0.9, "KO forward").status)
	require.Equal(t, 200, f.call("POST", "/api/v1/me/reading-progress", progressPayload("1", 0.1), nil).status)
	f.exec("UPDATE document_progress SET created_at='2099-01-01T00:00:00Z' WHERE device_id='ko'")
	require.Equal(t, 200, f.call("POST", "/api/v1/me/activity", activityPayload(), nil).status)
	require.NoError(t, f.db.CacheTempTables(context.Background()))
	var fraction, words, wpm float64
	var seconds int
	require.NoError(t, f.db.DB.QueryRow("SELECT percentage,total_time_seconds,total_words_read,total_wpm FROM document_user_statistics WHERE user_id='alice' AND document_id='book-a'").Scan(&fraction, &seconds, &words, &wpm))
	require.Equal(t, 0.1, fraction)
	require.Equal(t, 30, seconds)
	require.InDelta(t, 1000, words, 0.000001)
	require.InDelta(t, 2000, wpm, 0.000001)
	var legacy float64
	require.NoError(t, f.db.DB.QueryRow("SELECT percentage FROM document_progress WHERE device_id='ko'").Scan(&legacy))
	require.Equal(t, 0.9, legacy)
}
