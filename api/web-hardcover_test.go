package api

import (
	"context"
	"encoding/base64"
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
	mu                    sync.Mutex
	links                 map[hardcover.Account]string
	verifier              string
	exchanges             int
	connectErr, statusErr error
	disconnectErr         error
	beforeConnect         func()
	storeLink             func(context.Context, hardcover.Account) error
	revokeStored          func(context.Context, string, []byte)
}

func hardcoverFixture(t *testing.T, m *mockHardcover) *webFixture {
	f := newWebFixture(t)
	m.links = make(map[hardcover.Account]string)
	f.api.hardcoverAccounts.client = m
	f.register("alice")
	return f
}

func (m *mockHardcover) AuthorizeURL(state, verifier string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.verifier = verifier
	return "https://hardcover.app/oauth2/authorize?state=" + state
}

func (m *mockHardcover) Connect(ctx context.Context, account hardcover.Account, code, verifier string) error {
	if m.beforeConnect != nil {
		m.beforeConnect()
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.exchanges++
	if len(verifier) < 43 || verifier != m.verifier || code != "proof" {
		return errors.New("wrong code or verifier")
	}
	if m.connectErr != nil {
		return m.connectErr
	}
	if m.storeLink != nil {
		if err := m.storeLink(ctx, account); err != nil {
			return err
		}
	}
	m.links[account] = "hardcover-reader"
	return nil
}

func (m *mockHardcover) Status(account hardcover.Account) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if username := m.links[account]; username != "" {
		return username, m.statusErr
	}
	return "", hardcover.ErrNotConnected
}

func (m *mockHardcover) Shelf(_ context.Context, account hardcover.Account, offset int) (hardcover.Shelf, error) {
	if _, err := m.Status(account); err != nil || offset != 0 {
		return hardcover.Shelf{}, err
	}
	next := 25
	return hardcover.Shelf{Books: []hardcover.Book{{ID: "41", Title: "Book", Author: "Author"}}, NextOffset: &next}, nil
}

func (m *mockHardcover) Disconnect(ctx context.Context, account hardcover.Account) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if m.disconnectErr == nil {
		delete(m.links, account)
	}
	return m.disconnectErr
}

func (m *mockHardcover) RevokeStored(ctx context.Context, accountID string, encrypted []byte) {
	if m.revokeStored != nil {
		m.revokeStored(ctx, accountID, encrypted)
	}
}

func hardcoverBrowser(f *webFixture) *webFixture {
	f.t.Helper()
	jar, err := cookiejar.New(nil)
	require.NoError(f.t, err)
	browser := *f
	browser.client = &http.Client{Jar: jar, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &browser
}

func hardcoverLogin(f *webFixture) webResponse {
	f.bootstrap()
	r := f.call("POST", "/api/v1/session/login", Credentials{Username: "alice", Password: " password "}, nil)
	require.Equal(f.t, 200, r.status, string(r.body))
	f.setSession(decodeWeb[Session](f.t, r))
	return r
}

func beginHardcover(f *webFixture) url.Values {
	f.t.Helper()
	r := f.call("POST", hardcoverPath+"/connect", nil, nil)
	require.Equal(f.t, 200, r.status, string(r.body))
	location, err := url.Parse(decodeWeb[HardcoverConnect](f.t, r).AuthorizationUrl)
	require.NoError(f.t, err)
	return url.Values{"state": {location.Query().Get("state")}, "code": {"proof"}, "iss": {hardcoverIssuer}}
}

func finishHardcover(f *webFixture, values url.Values, origin string) webResponse {
	f.t.Helper()
	return f.call("POST", hardcoverCallbackPath, values.Encode(), map[string]string{"Origin": origin, "Content-Type": "application/x-www-form-urlencoded"})
}

func requireHardcoverJSON(f *webFixture, method, path, expected string) {
	f.t.Helper()
	r := f.call(method, hardcoverPath+path, nil, nil)
	require.Equal(f.t, 200, r.status, string(r.body))
	require.JSONEq(f.t, expected, string(r.body))
}

const unlinkedHardcover = `{"enabled":true,"username":null,"reconnect_required":false}`

func TestHardcoverEncryptionKeyConfiguration(t *testing.T) {
	f := newWebFixture(t)
	cfg := f.api.cfg
	cfg.HardcoverTokenKey = "invalid key"
	require.NoError(t, f.api.configureHardcover())
	require.Nil(t, f.api.hardcoverAccounts.client)

	cfg.HardcoverClientID, cfg.HardcoverClientSecret = "app-id", "app-secret"
	for _, key := range []string{"", "invalid key", base64.StdEncoding.EncodeToString(make([]byte, 31)), base64.StdEncoding.EncodeToString(make([]byte, 32)) + "\n"} {
		cfg.HardcoverTokenKey = key
		err := f.api.configureHardcover()
		require.ErrorContains(t, err, "HARDCOVER_TOKEN_KEY")
		if key != "" {
			require.NotContains(t, err.Error(), key)
		}
		require.Nil(t, f.api.hardcoverAccounts.client)
	}
	cfg.HardcoverTokenKey = base64.StdEncoding.EncodeToString(make([]byte, 32))
	require.NoError(t, f.api.configureHardcover())
	require.NotNil(t, f.api.hardcoverAccounts.client)
}

func TestHardcoverOAuth(t *testing.T) {
	m := &mockHardcover{}
	f := hardcoverFixture(t, m)
	anonymous, otherAccount, otherSession := hardcoverBrowser(f), hardcoverBrowser(f), hardcoverBrowser(f)
	otherAccount.register("bob")
	hardcoverLogin(otherSession)
	origin := f.cfg.PublicOrigin
	v := beginHardcover(f)
	land := func() webResponse { return anonymous.call("GET", hardcoverCallbackPath+"?"+v.Encode(), nil, nil) }
	r := land()
	require.Equal(t, 200, r.status)
	require.Equal(t, "no-store", r.header.Get("Cache-Control"))
	require.Equal(t, "no-referrer", r.header.Get("Referrer-Policy"))
	require.Contains(t, r.header.Get("Content-Security-Policy"), "frame-ancestors 'none'")
	require.Empty(t, r.header.Get("Set-Cookie"))
	require.NotContains(t, string(r.body), m.verifier)
	require.Zero(t, m.exchanges)
	for _, browser := range []*webFixture{anonymous, otherAccount, otherSession} {
		require.Equal(t, 403, finishHardcover(browser, v, origin).status)
	}
	require.Equal(t, 403, finishHardcover(f, v, "https://wrong.invalid").status)
	for _, field := range []string{"iss", "state", "code"} {
		value := v.Get(field)
		v.Add(field, value)
		require.Equal(t, 400, finishHardcover(f, v, origin).status)
		v.Set(field, value)
	}
	v.Set("iss", "https://wrong.invalid")
	require.Equal(t, 400, finishHardcover(f, v, origin).status)
	require.Equal(t, origin+hardcoverErrorPath, land().header.Get("Location"))
	v.Set("iss", hardcoverIssuer)
	state := v.Get("state")
	v.Set("state", strings.Repeat("f", 64))
	require.Equal(t, 403, finishHardcover(f, v, origin).status)
	v.Set("state", state)
	require.Equal(t, 204, finishHardcover(f, v, origin).status)
	require.Equal(t, 403, finishHardcover(f, v, origin).status)
	require.Equal(t, 1, m.exchanges)
	requireHardcoverJSON(otherAccount, "GET", "", unlinkedHardcover)
	requireHardcoverJSON(f, "GET", "", `{"enabled":true,"username":"hardcover-reader","reconnect_required":false}`)
	requireHardcoverJSON(f, "GET", "/shelf", `{"books":[{"id":"41","title":"Book","author":"Author"}],"next_offset":25}`)
	requireHardcoverJSON(f, "GET", "/shelf?offset=25", `{"books":[],"next_offset":null}`)
	assertProblem(t, f.call("GET", hardcoverPath+"/shelf?offset=-1", nil, nil), 400, "invalid_request")

	pending := beginHardcover(f)
	for range 2 {
		r := f.call("DELETE", hardcoverPath, nil, nil)
		require.Equal(t, 204, r.status, string(r.body))
		require.Empty(t, r.body)
	}
	require.Equal(t, 403, finishHardcover(f, pending, origin).status)
	assertProblem(t, f.call("GET", hardcoverPath+"/shelf", nil, nil), 409, "hardcover_not_connected")
}

func TestHardcoverDisconnectReportsFailedLocalDeletion(t *testing.T) {
	f := hardcoverFixture(t, &mockHardcover{statusErr: hardcover.ErrReconnect, disconnectErr: errors.New("local unlink failed")})
	require.Equal(t, 204, finishHardcover(f, beginHardcover(f), f.cfg.PublicOrigin).status)
	assertProblem(t, f.call("DELETE", hardcoverPath, nil, nil), 502, "hardcover_unavailable")
	requireHardcoverJSON(f, "GET", "", `{"enabled":true,"username":"hardcover-reader","reconnect_required":true}`)
}

func TestHardcoverCallbackRejectsExpiredStateAndStaleGeneration(t *testing.T) {
	m := &mockHardcover{}
	f := hardcoverFixture(t, m)
	origin := f.cfg.PublicOrigin
	v := beginHardcover(f)
	flow := &f.api.hardcoverAccounts
	flow.mu.Lock()
	a := flow.attempts[v.Get("state")]
	a.expires = time.Now().Add(-time.Minute)
	flow.attempts[v.Get("state")] = a
	flow.mu.Unlock()
	require.Equal(t, 403, finishHardcover(f, v, origin).status)
	require.Equal(t, 204, finishHardcover(f, beginHardcover(f), origin).status)
	pending := beginHardcover(f)
	f.exec("UPDATE reading_generation SET generation = ? WHERE singleton = 1", strings.Repeat("a", 32))
	require.Equal(t, 403, finishHardcover(f, pending, origin).status)
	hardcoverLogin(f)
	require.Equal(t, 403, finishHardcover(f, pending, origin).status)
	requireHardcoverJSON(f, "GET", "", unlinkedHardcover)
	require.Equal(t, 1, m.exchanges)
}

func TestHardcoverDisabledAndCallbackFailure(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	requireHardcoverJSON(f, "GET", "", `{"enabled":false,"username":null,"reconnect_required":false}`)
	assertProblem(t, f.call("POST", hardcoverPath+"/connect", nil, nil), 404, "hardcover_disabled")
	f.api.hardcoverAccounts.client = &mockHardcover{connectErr: errors.New("provider error with private details")}
	v := beginHardcover(f)
	r := finishHardcover(f, v, f.cfg.PublicOrigin)
	require.Equal(t, 502, r.status)
	require.Empty(t, r.body)
	require.Equal(t, 403, finishHardcover(f, v, f.cfg.PublicOrigin).status)
}
