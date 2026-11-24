package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/hardcover"
)

const hardcoverPath = "/api/v1/me/hardcover"

type mockHardcover struct {
	verifier          string
	mu                sync.Mutex
	links             map[string]string
	calls             int
	failure           error
	statusFailure     error
	disconnectFailure error
}

func (m *mockHardcover) AuthorizeURL(state, verifier string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.verifier = verifier
	return "https://hardcover.app/oauth2/authorize?" + (url.Values{"state": {state}}).Encode()
}

func (m *mockHardcover) Connect(_ context.Context, account, code, verifier string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	if verifier != m.verifier || code != "proof" {
		return errors.New("unexpected callback values")
	}
	if m.failure != nil {
		return m.failure
	}
	m.links[account] = "hardcover-alice"
	return nil
}

func (m *mockHardcover) Status(account string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if username := m.links[account]; username != "" {
		return username, m.statusFailure
	}
	return "", hardcover.ErrNotConnected
}

func (m *mockHardcover) Shelf(_ context.Context, account string, offset int) (hardcover.Shelf, error) {
	if _, err := m.Status(account); err != nil {
		return hardcover.Shelf{}, err
	}
	if offset == 0 {
		next := 25
		return hardcover.Shelf{Books: []hardcover.Book{{ID: "41", Title: "Book", Author: "Author"}}, NextOffset: &next}, nil
	}
	return hardcover.Shelf{}, nil
}

func (m *mockHardcover) Disconnect(_ context.Context, account string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.disconnectFailure == nil || errors.Is(m.disconnectFailure, hardcover.ErrRevocationUnconfirmed) {
		delete(m.links, account)
	}
	return m.disconnectFailure
}

func (m *mockHardcover) exchanges() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls
}

func hardcoverBrowser(f *webFixture) *webFixture {
	f.t.Helper()
	jar, err := cookiejar.New(nil)
	require.NoError(f.t, err)
	browser := *f
	browser.client = &http.Client{Jar: jar, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &browser
}

func beginHardcover(f *webFixture) url.Values {
	f.t.Helper()
	response := f.call("POST", hardcoverPath+"/connect", nil, nil)
	require.Equal(f.t, 200, response.status, string(response.body))
	location, err := url.Parse(decodeWeb[HardcoverConnect](f.t, response).AuthorizationUrl)
	require.NoError(f.t, err)
	state := location.Query().Get("state")
	require.Len(f.t, state, 64)
	return url.Values{"state": {state}, "code": {"proof"}, "iss": {hardcoverIssuer}}
}

func finishHardcover(f *webFixture, values url.Values, origin string) webResponse {
	f.t.Helper()
	return f.call("POST", hardcoverCallbackPath, values.Encode(), map[string]string{"Origin": origin, "Content-Type": "application/x-www-form-urlencoded"})
}

func TestHardcoverWebOAuthBindsOneExchangeToInitiatingSession(t *testing.T) {
	f := newWebFixture(t)
	m := &mockHardcover{links: make(map[string]string)}
	f.api.hardcover.client = m
	alice := f.register("alice")
	wrongAccount := hardcoverBrowser(f)
	wrongAccount.register("bob")
	wrongSession := hardcoverBrowser(f)
	wrongSession.bootstrap()
	r := wrongSession.call("POST", "/api/v1/session/login", Credentials{Username: "alice", Password: " password "}, nil)
	require.Equal(t, 200, r.status)
	wrongSession.setSession(decodeWeb[Session](t, r))
	anonymous := hardcoverBrowser(f)

	assertProblem(t, anonymous.call("GET", hardcoverPath, nil, nil), 401, "unauthenticated")
	assertProblem(t, f.call("POST", hardcoverPath+"/connect", nil, map[string]string{"Origin": "https://wrong.invalid"}), 403, "csrf_failed")
	assertProblem(t, f.call("POST", hardcoverPath+"/connect", nil, map[string]string{"X-CSRF-Token": strings.Repeat("0", 64)}), 403, "csrf_failed")
	assertProblem(t, f.call("POST", hardcoverPath+"/connect", nil, map[string]string{"X-AnthoLume-Account": "wrong-account"}), 401, "account_changed")
	r = f.call("GET", hardcoverPath, nil, nil)
	require.JSONEq(t, `{"enabled":true,"username":null,"reconnect_required":false}`, string(r.body))
	values := beginHardcover(f)
	r = anonymous.call("GET", hardcoverCallbackPath+"?"+values.Encode(), nil, nil)
	require.Equal(t, 200, r.status)
	require.Equal(t, "no-store", r.header.Get("Cache-Control"))
	require.Equal(t, "no-referrer", r.header.Get("Referrer-Policy"))
	require.Contains(t, r.header.Get("Content-Security-Policy"), "frame-ancestors 'none'")
	require.Empty(t, r.header.Get("Set-Cookie"))
	require.NotContains(t, string(r.body), m.verifier)
	require.Zero(t, m.exchanges())
	for _, browser := range []*webFixture{anonymous, wrongSession, wrongAccount} {
		require.Equal(t, 403, finishHardcover(browser, values, f.cfg.PublicOrigin).status)
	}
	require.Equal(t, 403, finishHardcover(f, values, "https://wrong.invalid").status)
	values.Set("iss", "https://wrong.invalid")
	require.Equal(t, 400, finishHardcover(f, values, f.cfg.PublicOrigin).status)
	r = anonymous.call("GET", hardcoverCallbackPath+"?"+values.Encode(), nil, nil)
	require.Equal(t, 303, r.status)
	require.Equal(t, f.cfg.PublicOrigin+hardcoverErrorPath, r.header.Get("Location"))
	require.Zero(t, m.exchanges())
	values.Set("iss", hardcoverIssuer)
	require.Equal(t, 204, finishHardcover(f, values, f.cfg.PublicOrigin).status)
	require.Equal(t, 403, finishHardcover(f, values, f.cfg.PublicOrigin).status)
	require.Equal(t, 1, m.exchanges())
	r = f.call("GET", hardcoverPath, nil, nil)
	require.JSONEq(t, `{"enabled":true,"username":"hardcover-alice","reconnect_required":false}`, string(r.body))
	_, err := m.Status(alice.User.ReadingGeneration + ":" + alice.User.AccountId)
	require.NoError(t, err)
	r = wrongAccount.call("GET", hardcoverPath, nil, nil)
	require.JSONEq(t, `{"enabled":true,"username":null,"reconnect_required":false}`, string(r.body))
	r = f.call("GET", hardcoverPath+"/shelf", nil, nil)
	require.JSONEq(t, `{"books":[{"id":"41","title":"Book","author":"Author"}],"next_offset":25}`, string(r.body))
	r = f.call("GET", hardcoverPath+"/shelf?offset=25", nil, nil)
	require.JSONEq(t, `{"books":[],"next_offset":null}`, string(r.body))
	assertProblem(t, f.call("GET", hardcoverPath+"/shelf?offset=-1", nil, nil), 400, "invalid_request")

	pending := beginHardcover(f)
	assertProblem(t, f.call("DELETE", hardcoverPath, nil, map[string]string{"X-CSRF-Token": strings.Repeat("0", 64)}), 403, "csrf_failed")
	r = f.call("DELETE", hardcoverPath, nil, nil)
	require.Equal(t, 200, r.status)
	require.JSONEq(t, `{"revocation_confirmed":true}`, string(r.body))
	r = f.call("DELETE", hardcoverPath, nil, nil)
	require.Equal(t, 200, r.status)
	require.JSONEq(t, `{"revocation_confirmed":true}`, string(r.body))
	require.Equal(t, 403, finishHardcover(f, pending, f.cfg.PublicOrigin).status)
	assertProblem(t, f.call("GET", hardcoverPath+"/shelf", nil, nil), 409, "hardcover_not_connected")
	require.Equal(t, 1, m.exchanges())
}

func TestHardcoverWebDisconnectDistinguishesRevocationFromLocalRemoval(t *testing.T) {
	for _, tc := range []struct {
		name    string
		failure error
	}{
		{"remote unknown", hardcover.ErrRevocationUnconfirmed},
		{"local failure", errors.New("local unlink failed")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newWebFixture(t)
			f.api.hardcover.client = &mockHardcover{links: make(map[string]string), statusFailure: hardcover.ErrReconnect, disconnectFailure: tc.failure}
			f.register("alice")
			require.Equal(t, 204, finishHardcover(f, beginHardcover(f), f.cfg.PublicOrigin).status)
			r := f.call("GET", hardcoverPath, nil, nil)
			require.Equal(t, 200, r.status)
			require.JSONEq(t, `{"enabled":true,"username":"hardcover-alice","reconnect_required":true}`, string(r.body))
			assertProblem(t, f.call("GET", hardcoverPath+"/shelf", nil, nil), 409, "hardcover_reconnect")

			r = f.call("DELETE", hardcoverPath, nil, nil)
			if errors.Is(tc.failure, hardcover.ErrRevocationUnconfirmed) {
				require.Equal(t, 200, r.status)
				require.JSONEq(t, `{"revocation_confirmed":false}`, string(r.body))
				r = f.call("GET", hardcoverPath, nil, nil)
				require.Equal(t, 200, r.status)
				require.JSONEq(t, `{"enabled":true,"username":null,"reconnect_required":false}`, string(r.body))
			} else {
				assertProblem(t, r, 502, "hardcover_unavailable")
				assertProblem(t, f.call("GET", hardcoverPath+"/shelf", nil, nil), 409, "hardcover_reconnect")
			}
		})
	}
}

func TestHardcoverWebRestoreInvalidatesPendingAndLinkedIdentity(t *testing.T) {
	f := newWebFixture(t)
	m := &mockHardcover{links: make(map[string]string)}
	f.api.hardcover.client = m
	original := f.register("alice")
	require.Equal(t, 204, finishHardcover(f, beginHardcover(f), f.cfg.PublicOrigin).status)
	pending := beginHardcover(f)

	f.exec("UPDATE reading_generation SET generation = ? WHERE singleton = 1", strings.Repeat("a", 32))
	require.Equal(t, 403, finishHardcover(f, pending, f.cfg.PublicOrigin).status)
	f.bootstrap()
	r := f.call("POST", "/api/v1/session/login", Credentials{Username: "alice", Password: " password "}, nil)
	require.Equal(t, 200, r.status)
	current := decodeWeb[Session](t, r)
	require.Equal(t, original.User.AccountId, current.User.AccountId)
	require.NotEqual(t, original.User.ReadingGeneration, current.User.ReadingGeneration)
	f.setSession(current)
	require.Equal(t, 403, finishHardcover(f, pending, f.cfg.PublicOrigin).status)
	r = f.call("GET", hardcoverPath, nil, nil)
	require.JSONEq(t, `{"enabled":true,"username":null,"reconnect_required":false}`, string(r.body))
	require.Equal(t, 1, m.exchanges())
}

func TestHardcoverWebDisabledAndCallbackFailure(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	r := f.call("GET", hardcoverPath, nil, nil)
	require.JSONEq(t, `{"enabled":false,"username":null,"reconnect_required":false}`, string(r.body))
	assertProblem(t, f.call("POST", hardcoverPath+"/connect", nil, nil), 404, "hardcover_disabled")

	m := &mockHardcover{failure: errors.New("provider error with private details")}
	f.api.hardcover.client = m
	values := beginHardcover(f)
	r = finishHardcover(f, values, f.cfg.PublicOrigin)
	require.Equal(t, 502, r.status)
	require.Empty(t, r.body)
	require.Equal(t, 403, finishHardcover(f, values, f.cfg.PublicOrigin).status)
	require.Equal(t, 1, m.exchanges())
}
