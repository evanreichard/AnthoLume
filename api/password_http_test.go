package api

import (
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSSRPasswordChangeRevokesOldCookiesWithoutOverwritingRole(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	parsed, err := url.Parse(f.server.URL)
	require.NoError(t, err)
	oldJar, err := cookiejar.New(nil)
	require.NoError(t, err)
	oldJar.SetCookies(parsed, f.client.Jar.Cookies(parsed))
	before := f.csrf
	response, err := f.client.PostForm(f.server.URL+"/settings", url.Values{"password": {"password"}, "new_password": {"replacement"}, "timezone": {"UTC"}})
	require.NoError(t, err)
	data, err := io.ReadAll(response.Body)
	response.Body.Close()
	require.NoError(t, err)
	require.Equal(t, 200, response.StatusCode, string(data))
	current := f.bootstrap()
	require.Equal(t, "alice", current.User.Id)
	require.True(t, current.User.IsAdmin)
	require.Equal(t, "UTC", current.User.Timezone)
	require.NotEqual(t, before, current.CsrfToken)
	oldClient := f.client
	f.client = &http.Client{Jar: oldJar}
	assertProblem(t, f.call("GET", "/api/v1/documents", nil, nil), 401, "unauthenticated")
	f.client = oldClient
	logout := f.call("POST", "/api/v1/session/logout", map[string]any{}, nil)
	require.Equal(t, 200, logout.status)
	f.csrf = decodeWeb[Session](t, logout).CsrfToken
	assertProblem(t, f.call("POST", "/api/v1/session/login", Credentials{Username: "alice", Password: "password"}, nil), 401, "unauthenticated")
	require.Equal(t, 200, f.call("POST", "/api/v1/session/login", Credentials{Username: "alice", Password: "replacement"}, nil).status)
}
