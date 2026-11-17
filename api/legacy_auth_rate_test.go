package api

import (
	"encoding/base64"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestSuccessfulLegacyHeaderAuthDoesNotThrottleSynchronization(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	f.client.Jar = nil
	basic := map[string]string{"Authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte("alice:password"))}
	for i := 0; i < 12; i++ {
		r := f.koWrite("book", "ko", 0.2, fmt.Sprintf("position-%d", i))
		require.Equal(t, 200, r.status, string(r.body))
		r = f.call("GET", "/api/opds", nil, basic)
		require.Equal(t, 200, r.status, string(r.body))
	}
	var revision int
	require.NoError(t, f.db.DB.QueryRow("SELECT revision FROM reading_heads WHERE user_id='alice' AND document_id='book'").Scan(&revision))
	require.Equal(t, 12, revision)
	bad := map[string]string{"Authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte("alice:wrong"))}
	for i := 0; i < 9; i++ {
		require.Equal(t, 401, f.call("GET", "/api/opds", nil, bad).status)
	}
	require.Equal(t, 429, f.call("GET", "/api/opds", nil, bad).status)
}
func TestCredentialRateRefundCannotAffectANewerWindow(t *testing.T) {
	limiter := credentialLimiter{}
	refund, ok := limiter.reserve("source")
	require.True(t, ok)
	limiter.mu.Lock()
	limiter.entries["source"] = attemptWindow{start: time.Now().Add(time.Minute), count: 4}
	limiter.mu.Unlock()
	refund()
	refund()
	require.Equal(t, 4, limiter.entries["source"].count)
}
