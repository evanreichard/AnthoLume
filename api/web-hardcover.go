package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"html/template"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"sync"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"
	"reichard.io/antholume/hardcover"
)

const (
	hardcoverCallbackPath = "/oauth/hardcover/callback"
	hardcoverIssuer       = "https://api.hardcover.app"
	hardcoverErrorPath    = "/settings?hardcover=error"
	hardcoverRequestLimit = 8192
	hardcoverAttemptsCap  = 512
	hardcoverAttemptTTL   = 10 * time.Minute
	hardcoverCallTimeout  = 15 * time.Second
)

type hardcoverProvider interface {
	AuthorizeURL(state, verifier string) string
	Connect(ctx context.Context, account, code, verifier string) error
	Status(account string) (string, error)
	Shelf(ctx context.Context, account string, offset int) (hardcover.Shelf, error)
	Disconnect(ctx context.Context, account string) error
}

type hardcoverAttempt struct {
	account  string
	session  string
	verifier string
	expires  time.Time
}

type hardcoverFlow struct {
	client   hardcoverProvider
	mu       sync.Mutex
	attempts map[string]hardcoverAttempt
	accounts [64]sync.Mutex
}

func (api *API) configureHardcover() error {
	id, secret := api.cfg.HardcoverClientID, api.cfg.HardcoverClientSecret
	if api.cfg.DemoMode || (id == "" && secret == "") {
		return nil
	}
	if id == "" || secret == "" {
		return errors.New("Hardcover requires both HARDCOVER_CLIENT_ID and HARDCOVER_CLIENT_SECRET")
	}
	client, err := hardcover.New(filepath.Join(api.cfg.ConfigPath, "hardcover"), id, secret, api.cfg.PublicOrigin+hardcoverCallbackPath)
	if err != nil {
		return errors.New("initialize Hardcover integration")
	}
	api.hardcover.client = client
	return nil
}

func hardcoverAccountKey(user authData) string {
	return user.Generation + ":" + user.AccountID
}

func (f *hardcoverFlow) lockAccount(account string) func() {
	lock := &f.accounts[sha256.Sum256([]byte(account))[0]%64]
	lock.Lock()
	return lock.Unlock
}

func (f *hardcoverFlow) start(account, session, verifier, state string, now time.Time) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for key, attempt := range f.attempts {
		if !now.Before(attempt.expires) || attempt.account == account {
			delete(f.attempts, key)
		}
	}
	if len(f.attempts) >= hardcoverAttemptsCap {
		return false
	}
	if f.attempts == nil {
		f.attempts = make(map[string]hardcoverAttempt)
	}
	f.attempts[state] = hardcoverAttempt{account, session, verifier, now.Add(hardcoverAttemptTTL)}
	return true
}

func (f *hardcoverFlow) cancel(account string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for state, attempt := range f.attempts {
		if attempt.account == account {
			delete(f.attempts, state)
		}
	}
}

func (f *hardcoverFlow) live(state string, now time.Time) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	attempt, ok := f.attempts[state]
	return ok && now.Before(attempt.expires)
}

func (f *hardcoverFlow) take(account, session, state string, now time.Time) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	attempt, ok := f.attempts[state]
	if !ok || !now.Before(attempt.expires) || attempt.account != account || subtle.ConstantTimeCompare([]byte(attempt.session), []byte(session)) != 1 {
		return "", false
	}
	delete(f.attempts, state)
	return attempt.verifier, true
}

func (s *webAPI) GetHardcover(ctx context.Context, _ GetHardcoverRequestObject) (GetHardcoverResponseObject, error) {
	client := s.api.hardcover.client
	if client == nil {
		return GetHardcover200JSONResponse{}, nil
	}
	status := GetHardcover200JSONResponse{Enabled: true}
	username, err := client.Status(hardcoverAccountKey(webUser(ctx)))
	if err != nil && !errors.Is(err, hardcover.ErrNotConnected) && !errors.Is(err, hardcover.ErrReconnect) {
		return nil, hardcoverError(err)
	}
	if username != "" {
		status.Username = &username
	}
	status.ReconnectRequired = errors.Is(err, hardcover.ErrReconnect)
	return status, nil
}

func (s *webAPI) ConnectHardcover(ctx context.Context, _ ConnectHardcoverRequestObject) (ConnectHardcoverResponseObject, error) {
	f := &s.api.hardcover
	if f.client == nil {
		return nil, &webFailure{status: 404, code: "hardcover_disabled"}
	}
	// Session Binding - webBoundary already validated this session's CSRF secret.
	session, _ := sessions.Default(ginContext(ctx)).Get("csrf").(string)
	state, err := randomCSRF()
	if err != nil {
		return nil, err
	}
	verifier := oauth2.GenerateVerifier()
	account := hardcoverAccountKey(webUser(ctx))
	defer f.lockAccount(account)()
	if !f.start(account, session, verifier, state, time.Now()) {
		return nil, &webFailure{status: 429, code: "rate_limited"}
	}
	return ConnectHardcover200JSONResponse{AuthorizationUrl: f.client.AuthorizeURL(state, verifier)}, nil
}

func (s *webAPI) DisconnectHardcover(ctx context.Context, _ DisconnectHardcoverRequestObject) (DisconnectHardcoverResponseObject, error) {
	f := &s.api.hardcover
	if f.client == nil {
		return nil, &webFailure{status: 404, code: "hardcover_disabled"}
	}
	account := hardcoverAccountKey(webUser(ctx))
	defer f.lockAccount(account)()
	f.cancel(account)
	call, cancel := context.WithTimeout(requestContext(ctx), hardcoverCallTimeout)
	defer cancel()
	err := f.client.Disconnect(call, account)
	switch {
	case err == nil, errors.Is(err, hardcover.ErrNotConnected):
		return DisconnectHardcover200JSONResponse{RevocationConfirmed: true}, nil
	case errors.Is(err, hardcover.ErrRevocationUnconfirmed):
		return DisconnectHardcover200JSONResponse{RevocationConfirmed: false}, nil
	default:
		return nil, hardcoverError(err)
	}
}

func (s *webAPI) GetHardcoverShelf(ctx context.Context, r GetHardcoverShelfRequestObject) (GetHardcoverShelfResponseObject, error) {
	client := s.api.hardcover.client
	if client == nil {
		return nil, &webFailure{status: 404, code: "hardcover_disabled"}
	}
	offset := 0
	if r.Params.Offset != nil {
		offset = *r.Params.Offset
	}
	call, cancel := context.WithTimeout(requestContext(ctx), hardcoverCallTimeout)
	defer cancel()
	page, err := client.Shelf(call, hardcoverAccountKey(webUser(ctx)), offset)
	if err != nil {
		return nil, hardcoverError(err)
	}
	books := make([]HardcoverBook, 0, len(page.Books))
	for _, book := range page.Books {
		books = append(books, HardcoverBook{Id: book.ID, Title: book.Title, Author: book.Author})
	}
	return GetHardcoverShelf200JSONResponse{Books: books, NextOffset: page.NextOffset}, nil
}

func hardcoverError(err error) error {
	switch {
	case errors.Is(err, hardcover.ErrNotConnected):
		return &webFailure{status: 409, code: "hardcover_not_connected"}
	case errors.Is(err, hardcover.ErrReconnect):
		return &webFailure{status: 409, code: "hardcover_reconnect"}
	case errors.Is(err, hardcover.ErrInvalidInput):
		return &webFailure{status: 400, code: "invalid_request"}
	default:
		return &webFailure{status: 502, code: "hardcover_unavailable"}
	}
}

func hardcoverCallbackHeaders(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("X-Frame-Options", "DENY")
}

func (api *API) hardcoverCallback(c *gin.Context) {
	hardcoverCallbackHeaders(c)
	query := c.Request.URL.RawQuery
	if api.hardcover.client != nil && len(query) <= hardcoverRequestLimit {
		params, err := url.ParseQuery(query)
		state, code, ok := hardcoverCallbackValues(params)
		if err == nil && ok && api.hardcover.live(state, time.Now()) {
			if nonce, err := randomCSRF(); err == nil {
				c.Header("Content-Security-Policy", "default-src 'none'; script-src 'nonce-"+nonce+"'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
				c.Header("Content-Type", "text/html; charset=utf-8")
				// First-Party Hop - The cross-site navigation has no Strict cookie; a fetch from the committed document does.
				_ = hardcoverCallbackPage.Execute(c.Writer, struct{ Origin, State, Code, Issuer, Nonce string }{api.cfg.PublicOrigin, state, code, hardcoverIssuer, nonce})
				return
			}
		}
	}
	c.Redirect(http.StatusSeeOther, api.cfg.PublicOrigin+hardcoverErrorPath)
}

func hardcoverCallbackValues(values url.Values) (state, code string, ok bool) {
	if len(values["error"]) != 0 || len(values["state"]) != 1 || len(values["code"]) != 1 || len(values["iss"]) != 1 {
		return "", "", false
	}
	state, code = values.Get("state"), values.Get("code")
	return state, code, len(state) == 64 && len(code) > 0 && len(code) <= 4096 && values.Get("iss") == hardcoverIssuer
}

var hardcoverCallbackPage = template.Must(template.New("hardcover-callback").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Connecting Hardcover · AnthoLume</title></head>
<body><p role="status">Connecting Hardcover…</p><noscript><a href="/settings?hardcover=error">Return to Settings and enable JavaScript to connect Hardcover</a></noscript>
<script nonce="{{.Nonce}}">
(async () => {
  if (location.origin !== {{.Origin}}) { location.replace({{.Origin}} + '/settings?hardcover=error'); return; }
  history.replaceState(null, '', location.pathname);
  let result = 'error';
  try {
    const response = await fetch('/oauth/hardcover/callback', {
      method: 'POST', mode: 'cors', credentials: 'same-origin', redirect: 'error',
      body: new URLSearchParams({ state: {{.State}}, code: {{.Code}}, iss: {{.Issuer}} })
    });
    if (response.status === 204) result = 'connected';
  } catch {}
  location.replace('/settings?hardcover=' + result);
})();
</script></body></html>`))

func (api *API) finishHardcoverCallback(c *gin.Context) {
	hardcoverCallbackHeaders(c)
	f := &api.hardcover
	origin := c.Request.Header.Values("Origin")
	if f.client == nil || len(origin) != 1 || origin[0] != api.cfg.PublicOrigin {
		c.Status(http.StatusForbidden)
		return
	}
	media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if media != "application/x-www-form-urlencoded" || err != nil || c.Request.URL.RawQuery != "" {
		c.Status(http.StatusBadRequest)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, hardcoverRequestLimit)
	err = c.Request.ParseForm()
	state, code, ok := hardcoverCallbackValues(c.Request.PostForm)
	if err != nil || !ok {
		c.Status(http.StatusBadRequest)
		return
	}
	ctx := c.Request.Context()
	session := sessions.Default(c)
	user, ok, err := api.sessionIdentity(ctx, session)
	csrf, _ := session.Get("csrf").(string)
	if err != nil || !ok || csrf == "" {
		c.Status(http.StatusForbidden)
		return
	}
	account := hardcoverAccountKey(user)
	defer f.lockAccount(account)()
	verifier, ok := f.take(account, csrf, state, time.Now())
	if !ok {
		c.Status(http.StatusForbidden)
		return
	}
	call, cancel := context.WithTimeout(ctx, hardcoverCallTimeout)
	defer cancel()
	if err := f.client.Connect(call, account, code, verifier); err != nil {
		c.Status(http.StatusBadGateway)
		return
	}
	c.Status(http.StatusNoContent)
}
