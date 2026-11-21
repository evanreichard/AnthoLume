package api

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRestoreFencesSessionsAndReadingEvents(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	other := *f
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	other.client = &http.Client{Jar: jar, Timeout: 10 * time.Second}
	other.bootstrap()
	login := func() Session {
		r := other.call("POST", "/api/v1/session/login", Credentials{Username: "alice", Password: "password"}, nil)
		require.Equal(t, 200, r.status, string(r.body))
		session := decodeWeb[Session](t, r)
		other.setSession(session)
		return session
	}
	old := login()
	backupDir := filepath.Join(t.TempDir(), "export")
	require.NoError(t, f.api.createAdminBackup(context.Background(), backupDir))
	payload, err := os.ReadFile(filepath.Join(backupDir, adminBackupName))
	require.NoError(t, err)
	progress := progressPayload("0", .4)
	activity := activityPayload()
	require.Equal(t, 200, other.call("POST", "/api/v1/me/reading-progress", progress, nil).status)
	require.Equal(t, 200, other.call("POST", "/api/v1/me/activity", activity, nil).status)

	staged := f.call("POST", "/api/v1/admin/restore", string(payload), map[string]string{"Content-Type": "application/octet-stream"})
	require.Equal(t, 200, staged.status, string(staged.body))
	require.Equal(t, 204, f.call("PATCH", "/api/v1/admin/restore", AdminRestoreApply{Token: decodeWeb[AdminRestore](t, staged).Token}, nil).status)
	assertProblem(t, other.call("GET", "/api/v1/documents", nil, nil), 401, "unauthenticated")
	require.Nil(t, other.bootstrap().User)
	fresh := login()
	require.Equal(t, old.User.AccountId, fresh.User.AccountId)
	require.NotEqual(t, old.User.ReadingGeneration, fresh.User.ReadingGeneration)

	for path, event := range map[string]any{"/api/v1/me/reading-progress": progress, "/api/v1/me/activity": activity} {
		assertProblem(t, other.call("POST", path, event, map[string]string{"X-AnthoLume-Reading-Generation": old.User.ReadingGeneration}), 409, "stale_reading_generation")
		other.generation = ""
		assertProblem(t, other.call("POST", path, event, nil), 409, "stale_reading_generation")
		other.generation = fresh.User.ReadingGeneration
	}
	require.Zero(t, f.count("reading_receipts"))
	require.Zero(t, f.count("activity"))
	require.Equal(t, 200, other.call("POST", "/api/v1/me/reading-progress", progressPayload("0", .6), nil).status)
}
