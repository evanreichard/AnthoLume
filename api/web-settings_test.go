package api

import (
	"net/http"
	"net/http/cookiejar"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestWebSettingsTimezonePasswordAndDeviceOwnership(t *testing.T) {
	f := newWebFixture(t)
	original := f.register("alice")
	freshClient := func() webFixture {
		jar, err := cookiejar.New(nil)
		require.NoError(t, err)
		copy := *f
		copy.client = &http.Client{Jar: jar, Timeout: 10 * time.Second}
		return copy
	}
	otherSession := freshClient()
	otherSession.bootstrap()
	login := otherSession.call("POST", "/api/v1/session/login", Credentials{Username: "alice", Password: " password "}, nil)
	require.Equal(t, 200, login.status, string(login.body))
	bob := freshClient()
	bob.register("bob")
	devicePath := "/api/v1/me/devices"
	require.Equal(t, 200, f.call("POST", devicePath, Device{Id: "browser", Name: "Browser"}, nil).status)
	require.Empty(t, decodeWeb[[]ManagedDevice](t, bob.call("GET", devicePath, nil, nil)))
	edit := DevicePreferences{Label: "Bedside", Archived: true}
	assertProblem(t, bob.call("PATCH", devicePath+"/browser", edit, nil), 404, "not_found")
	require.Equal(t, 200, f.call("PATCH", devicePath+"/browser", edit, nil).status)
	require.Equal(t, 200, f.call("POST", devicePath, Device{Id: "browser", Name: "Renamed by client"}, nil).status)
	devices := decodeWeb[[]ManagedDevice](t, f.call("GET", devicePath, nil, nil))
	require.Len(t, devices, 1)
	require.Equal(t, "Bedside", devices[0].Label)
	require.Equal(t, "Renamed by client", devices[0].Name)
	require.True(t, devices[0].Archived)
	assertProblem(t, f.call("PATCH", "/api/v1/me/preferences", PreferencesUpdate{Timezone: "Local"}, nil), 400, "invalid_timezone")
	result := f.call("PATCH", "/api/v1/me/preferences", PreferencesUpdate{Timezone: "Asia/Tokyo"}, nil)
	require.Equal(t, 200, result.status, string(result.body))
	require.Equal(t, "Asia/Tokyo", decodeWeb[Session](t, result).User.Timezone)
	require.Equal(t, "Asia/Tokyo", decodeWeb[Insights](t, f.call("GET", "/api/v1/me/insights", nil, nil)).Timezone)
	assertProblem(t, f.call("POST", "/api/v1/me/password", PasswordChange{CurrentPassword: "wrong", NewPassword: "replacement password"}, nil), 403, "incorrect_password")
	result = f.call("POST", "/api/v1/me/password", PasswordChange{CurrentPassword: "password", NewPassword: "replacement password"}, nil)
	require.Equal(t, 200, result.status, string(result.body))
	rotated := decodeWeb[Session](t, result)
	require.Equal(t, "alice", rotated.User.Id)
	require.NotEqual(t, original.CsrfToken, rotated.CsrfToken)
	assertProblem(t, otherSession.call("GET", devicePath, nil, nil), 401, "unauthenticated")
	assertProblem(t, f.call("PATCH", devicePath+"/browser", edit, nil), 403, "csrf_failed")
	f.csrf = rotated.CsrfToken
	edit.Archived = false
	require.Equal(t, 200, f.call("PATCH", devicePath+"/browser", edit, nil).status)
	otherSession.bootstrap()
	assertProblem(t, otherSession.call("POST", "/api/v1/session/login", Credentials{Username: "alice", Password: "password"}, nil), 401, "unauthenticated")
	require.Equal(t, 200, otherSession.call("POST", "/api/v1/session/login", Credentials{Username: "alice", Password: "replacement password"}, nil).status)
}
