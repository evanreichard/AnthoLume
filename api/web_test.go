package api

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

type webFixture struct {
	t          *testing.T
	cfg        *config.Config
	db         *database.DBManager
	api        *API
	server     *httptest.Server
	client     *http.Client
	csrf       string
	generation string
}
type webResponse struct {
	status int
	header http.Header
	body   []byte
}

func newWebFixture(t *testing.T) *webFixture {
	t.Helper()
	gin.SetMode(gin.ReleaseMode)
	root := t.TempDir()
	cfg := &config.Config{Version: "test", DBType: "sqlite", DBName: "test", ConfigPath: root, DataPath: filepath.Join(root, "data"), CookieAuthKey: strings.Repeat("synthetic-test-key", 4), RegistrationEnabled: true}
	cfg.EnsureDirectories()
	db := database.NewMgr(cfg)
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	f := &webFixture{t: t, cfg: cfg, db: db, client: &http.Client{Jar: jar, Timeout: 10 * time.Second}}
	f.start()
	t.Cleanup(func() {
		f.server.Close()
		require.NoError(t, f.api.Stop())
		require.NoError(t, f.db.DB.Close())
	})
	return f
}
func (f *webFixture) start() {
	f.server = httptest.NewUnstartedServer(nil)
	f.cfg.PublicOrigin = "http://" + f.server.Listener.Addr().String()
	var err error
	f.api, err = NewAPI(f.db, f.cfg, overlayAssets{fstest.MapFS{shellPathsFile: {Data: []byte(`["/"]`)}}, os.DirFS("..")})
	require.NoError(f.t, err)
	f.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Test-Drop-Response") == "yes" {
			recorded := httptest.NewRecorder()
			f.api.Handler().ServeHTTP(recorded, r)
			conn, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				conn.Close()
			}
			return
		}
		f.api.Handler().ServeHTTP(w, r)
	})
	f.server.Start()
}
func (f *webFixture) call(method, path string, body any, headers map[string]string) webResponse {
	f.t.Helper()
	var b []byte
	switch value := body.(type) {
	case nil:
	case string:
		b = []byte(value)
	default:
		var err error
		b, err = json.Marshal(body)
		require.NoError(f.t, err)
	}
	r, err := http.NewRequest(method, f.server.URL+path, bytes.NewReader(b))
	require.NoError(f.t, err)
	if method != "GET" {
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", f.cfg.PublicOrigin)
		r.Header.Set("X-CSRF-Token", f.csrf)
	}
	if (path == "/api/v1/me/reading-progress" || path == "/api/v1/me/activity") && f.generation != "" {
		r.Header.Set("X-AnthoLume-Reading-Generation", f.generation)
	}
	for k, v := range headers {
		r.Header.Set(k, v)
	}
	response, err := f.client.Do(r)
	require.NoError(f.t, err)
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	require.NoError(f.t, err)
	return webResponse{response.StatusCode, response.Header, data}
}
func decodeWeb[T any](t *testing.T, r webResponse) T {
	t.Helper()
	var result T
	require.NoError(t, json.Unmarshal(r.body, &result), string(r.body))
	return result
}
func (f *webFixture) bootstrap() Session {
	r := f.call("GET", "/api/v1/session", nil, nil)
	require.Equal(f.t, 200, r.status, string(r.body))
	out := decodeWeb[Session](f.t, r)
	f.setSession(out)
	return out
}
func (f *webFixture) register(user string) Session {
	f.bootstrap()
	r := f.call("POST", "/api/v1/session/register", Credentials{Username: user, Password: " password "}, nil)
	require.Equal(f.t, 201, r.status, string(r.body))
	out := decodeWeb[Session](f.t, r)
	f.setSession(out)
	return out
}
func (f *webFixture) setSession(out Session) {
	f.csrf = out.CsrfToken
	f.generation = ""
	if out.User != nil {
		f.generation = out.User.ReadingGeneration
	}
}
func (f *webFixture) exec(query string, args ...any) {
	f.t.Helper()
	_, err := f.db.DB.Exec(query, args...)
	require.NoError(f.t, err)
}
func (f *webFixture) rewindReactMigrations() {
	f.t.Helper()
	// Goose rejects gaps, so restore the legacy identifier columns before marking all later migrations pending.
	f.exec(`DROP TABLE metadata_provider;
 DROP TABLE document_identifiers;
 ALTER TABLE documents ADD COLUMN gbid TEXT;
 ALTER TABLE documents ADD COLUMN olid TEXT;
 DELETE FROM goose_db_version WHERE version_id>=20261126000000`)
}
func (f *webFixture) count(table string) int {
	f.t.Helper()
	var n int
	require.NoError(f.t, f.db.DB.QueryRow("SELECT count(*) FROM "+table).Scan(&n))
	return n
}
func (f *webFixture) readingSetup() {
	f.register("alice")
	f.exec("INSERT INTO documents(id,title) VALUES('book_a','A literal %_ book'),('book-b','Other')")
	r := f.call("POST", "/api/v1/me/devices", Device{Id: "web-device", Name: "Browser"}, nil)
	require.Equal(f.t, 200, r.status, string(r.body))
}
func progressPayload(base string, fraction float64) map[string]any {
	return map[string]any{"event_id": uuid.NewString(), "document_id": "book_a", "device_id": "web-device", "observed_at": "2026-01-01T12:00:00Z", "base_revision": base, "position": "/body/DocFragment[1]/body/p[2]/text().0", "fraction": fraction}
}
func activityPayload() map[string]any {
	return map[string]any{"event_id": uuid.NewString(), "document_id": "book_a", "device_id": "web-device", "start_time": "2026-01-01T12:00:00Z", "duration": 30, "start_fraction": 0.1, "end_fraction": 0.2}
}
func assertProblem(t *testing.T, r webResponse, status int, code string) {
	t.Helper()
	require.Equal(t, status, r.status, string(r.body))
	require.Equal(t, "application/problem+json", r.header.Get("Content-Type"))
	p := decodeWeb[Problem](t, r)
	require.Equal(t, status, p.Status)
	require.Equal(t, code, p.Code)
	require.NotContains(t, string(r.body), "SELECT ")
	require.NotContains(t, string(r.body), "/tmp/")
}

func TestBookDetailStatsAreAccountScoped(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	f.exec("UPDATE documents SET words=10000 WHERE id='book_a'")
	r := f.call("POST", "/api/v1/me/activity", activityPayload(), nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.NoError(t, f.db.CacheTempTables(context.Background()))

	path := "/api/v1/documents/book_a"
	r = f.call("GET", path, nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	stats := decodeWeb[Document](t, r).ReadingStats
	require.NotNil(t, stats)
	require.EqualValues(t, 30, stats.ReadingSeconds)
	require.EqualValues(t, 10000, *stats.WordCount)
	require.Positive(t, stats.WordsPerMinute)

	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	other := *f
	other.client = &http.Client{Jar: jar, Timeout: 10 * time.Second}
	assertProblem(t, other.call("GET", path, nil, nil), 401, "unauthenticated")
	other.register("bob")
	r = other.call("GET", path, nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	stats = decodeWeb[Document](t, r).ReadingStats
	require.NotNil(t, stats)
	require.Zero(t, stats.ReadingSeconds)
	require.Zero(t, stats.WordsPerMinute)
}

func TestWebIdentityCSRFAndRevocation(t *testing.T) {
	f := newWebFixture(t)
	anonymous := f.bootstrap()
	require.Nil(t, anonymous.User)
	require.Nil(t, anonymous.ExpiresAt)
	require.Len(t, anonymous.CsrfToken, 64)
	require.Equal(t, anonymous.CsrfToken, f.bootstrap().CsrfToken)
	secondJar, err := cookiejar.New(nil)
	require.NoError(t, err)
	other := *f
	other.client = &http.Client{Jar: secondJar, Timeout: 10 * time.Second}
	require.NotEqual(t, anonymous.CsrfToken, other.bootstrap().CsrfToken)
	assertProblem(t, f.call("POST", "/api/v1/session/login", Credentials{"password", "alice"}, map[string]string{"Origin": "https://wrong.invalid"}), 403, "csrf_failed")
	assertProblem(t, f.call("POST", "/api/v1/session/register", Credentials{"password", "alice"}, map[string]string{"X-CSRF-Token": other.csrf}), 403, "csrf_failed")
	registered := f.register("alice")
	require.NotNil(t, registered.User)
	require.True(t, registered.User.IsAdmin)
	require.Equal(t, "alice", registered.User.Id)
	require.NotEqual(t, anonymous.CsrfToken, registered.CsrfToken)
	require.WithinDuration(t, time.Now().Add(7*24*time.Hour), *registered.ExpiresAt, 3*time.Second)
	f.exec("UPDATE users SET admin=0 WHERE id='alice'")
	require.False(t, f.bootstrap().User.IsAdmin)
	assertProblem(t, f.call("POST", "/api/v1/session/logout", map[string]any{}, map[string]string{"X-CSRF-Token": anonymous.CsrfToken}), 403, "csrf_failed")
	loggedOut := f.call("POST", "/api/v1/session/logout", map[string]any{}, nil)
	require.Equal(t, 200, loggedOut.status)
	out := decodeWeb[Session](t, loggedOut)
	require.Nil(t, out.User)
	require.NotEqual(t, registered.CsrfToken, out.CsrfToken)
	f.csrf = out.CsrfToken
	assertProblem(t, f.call("GET", "/api/v1/documents", nil, nil), 401, "unauthenticated")
	login := f.call("POST", "/api/v1/session/login", Credentials{Username: " alice ", Password: " password "}, nil)
	require.Equal(t, 200, login.status, string(login.body))
	f.csrf = decodeWeb[Session](t, login).CsrfToken
	require.Contains(t, strings.Join(login.header.Values("Set-Cookie"), ";"), "HttpOnly")
	require.Contains(t, strings.Join(login.header.Values("Set-Cookie"), ";"), "SameSite=Strict")
	f.exec("UPDATE users SET auth_hash='revoked' WHERE id='alice'")
	assertProblem(t, f.call("GET", "/api/v1/documents", nil, nil), 401, "unauthenticated")
	require.Nil(t, f.bootstrap().User)
	f.cfg.RegistrationEnabled = false
	assertProblem(t, f.call("POST", "/api/v1/session/register", Credentials{Username: "bob", Password: "password"}, nil), 403, "forbidden")
}
func TestWebCredentialsFirstAdminAndLimits(t *testing.T) {
	f := newWebFixture(t)
	f.bootstrap()
	// Both requests use real credentials/session issuance; first-user administration is decided inside the DB transaction.
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for _, user := range []string{"one", "two"} {
		wg.Add(1)
		go func(user string) {
			defer wg.Done()
			r := f.call("POST", "/api/v1/session/register", Credentials{Username: user, Password: "password"}, nil)
			statuses <- r.status
		}(user)
	}
	wg.Wait()
	close(statuses)
	for status := range statuses {
		require.Equal(t, 201, status)
	}
	var admins int
	require.NoError(t, f.db.DB.QueryRow("SELECT count(*) FROM users WHERE admin=1").Scan(&admins))
	require.Equal(t, 1, admins)
	// Use an independent bounded limiter to avoid depending on which concurrent session cookie won the browser jar.
	limiter := credentialLimiter{}
	for i := 0; i < 10; i++ {
		require.True(t, limiter.allow("source"))
	}
	require.False(t, limiter.allow("source"))
	for i := 0; i < 1023; i++ {
		require.True(t, limiter.allow(fmt.Sprint(i)))
	}
	require.False(t, limiter.allow("new-source"))
	require.Len(t, limiter.entries, 1024)
	fresh := newWebFixture(t)
	fresh.bootstrap()
	for i := 0; i < 10; i++ {
		assertProblem(t, fresh.call("POST", "/api/v1/session/login", Credentials{Username: "missing", Password: "password"}, nil), 401, "unauthenticated")
	}
	assertProblem(t, fresh.call("POST", "/api/v1/session/login", Credentials{Username: "missing", Password: "password"}, nil), 429, "rate_limited")
}
func TestWebJSONClosedValidationAndCancellation(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	good := progressPayload("0", 0.5)
	valid, err := json.Marshal(good)
	require.NoError(t, err)
	for _, body := range []string{
		`{}`, `null`, `[]`, string(valid) + ` {}`, strings.Replace(string(valid), `"fraction":0.5`, `"fraction":1.1`, 1),
		strings.Replace(string(valid), `"fraction":0.5`, `"fraction":null`, 1),
		strings.Replace(string(valid), `"fraction":0.5`, `"fraction":0.5,"fraction":0.5`, 1),
		strings.Replace(string(valid), `"fraction":0.5`, `"fraction":0.5,"\u0066raction":0.5`, 1),
		strings.Replace(string(valid), `"fraction":0.5`, `"Fraction":0.5`, 1),
		strings.Replace(string(valid), `"fraction":0.5`, `"fraction":0.5,"private":true`, 1),
		strings.Replace(string(valid), `"base_revision":"0"`, `"base_revision":"01"`, 1),
		strings.Replace(string(valid), `2026-01-01T12:00:00Z`, `yesterday`, 1),
		strings.Replace(string(valid), good["event_id"].(string), "not-a-uuid", 1),
		strings.Replace(string(valid), `"position":"`, `"position":"`+strings.Repeat("a", 4097), 1),
	} {
		assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", body, nil), 400, "invalid_request")
	}
	assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", string(valid), map[string]string{"Content-Type": "text/plain"}), 415, "invalid_request")
	assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", strings.Repeat(" ", 8193), nil), 413, "invalid_request")
	a := activityPayload()
	a["start_fraction"] = 0.9
	assertProblem(t, f.call("POST", "/api/v1/me/activity", a, nil), 400, "invalid_request")
	require.Zero(t, f.count("reading_receipts"))
	require.Zero(t, f.count("document_progress"))
	require.Zero(t, f.count("activity"))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = f.api.reading.State(ctx, "alice", "book_a")
	require.ErrorIs(t, err, context.Canceled)
}
func TestWebExpiryAndSignedCookies(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	// Expiry is a signed server field; no fixture/bootstrap handler is installed in the production router.
	request := httptest.NewRequest("GET", f.server.URL+"/api/v1/session", nil)
	for _, cookie := range f.client.Jar.Cookies(request.URL) {
		request.AddCookie(cookie)
	}
	recorder := httptest.NewRecorder()
	var saved bool
	handler := gin.New()
	storeKey := []byte(f.cfg.CookieAuthKey)
	handler.Use(sessions.Sessions("token", cookie.NewStore(storeKey)))
	handler.GET("/", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("expiresAt", time.Now().Add(-time.Second).Unix())
		require.NoError(t, session.Save())
		saved = true
	})
	request.URL.Path = "/"
	handler.ServeHTTP(recorder, request)
	require.True(t, saved)
	f.client.Jar.SetCookies(request.URL, recorder.Result().Cookies())
	assertProblem(t, f.call("GET", "/api/v1/documents", nil, nil), 401, "unauthenticated")
	require.Nil(t, f.bootstrap().User)
	f.client.Jar.SetCookies(request.URL, []*http.Cookie{{Name: "token", Value: "invalid-signature", Path: "/"}})
	require.Nil(t, f.bootstrap().User)
}
func koHeaders() map[string]string {
	return map[string]string{"x-auth-user": "alice", "x-auth-key": fmt.Sprintf("%x", md5.Sum([]byte("password")))}
}
