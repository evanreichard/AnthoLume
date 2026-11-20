package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// Pinned Oracle - Wire goldens come from koreader-sync-server 46ef6b84 config/errors.lua and syncs_controller_spec.lua.
func koSyncHTTP(t *testing.T, f *webFixture, method, path string, body any, headers map[string]string, cookies []*http.Cookie) webResponse {
	t.Helper()
	var data []byte
	if raw, ok := body.(string); ok {
		data = []byte(raw)
	} else if body != nil {
		var err error
		data, err = json.Marshal(body)
		require.NoError(t, err)
	}
	req, err := http.NewRequest(method, f.server.URL+path, bytes.NewReader(data))
	require.NoError(t, err)
	req.Header.Set("Accept", "application/vnd.koreader.v1+json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	require.NoError(t, err)
	defer response.Body.Close()
	data, err = io.ReadAll(response.Body)
	require.NoError(t, err)
	return webResponse{response.StatusCode, response.Header, data}
}

func assertKOSyncGolden(t *testing.T, r webResponse, status int, body string) {
	t.Helper()
	require.Equal(t, status, r.status, string(r.body))
	require.Equal(t, "application/json", r.header.Get("Content-Type"))
	require.JSONEq(t, body, string(r.body))
}

func TestKOSyncErrorsSignupAndAuthGoldens(t *testing.T) {
	f := newWebFixture(t)
	create := func(body any) webResponse {
		return koSyncHTTP(t, f, "POST", "/api/ko/users/create", body, nil, nil)
	}
	assertKOSyncGolden(t, create(`{"username":"new-user","password":"passwd123"}`), 201, `{"username":"new-user"}`)
	assertKOSyncGolden(t, create(`{"username":"new-user","password":"passwd123"}`), 402, `{"code":2002,"message":"Username is already registered."}`)
	for _, key := range []string{"", "wrong_password", "passwd123"} {
		r := koSyncHTTP(t, f, "GET", "/api/ko/users/auth", nil, map[string]string{"x-auth-user": "new-user", "x-auth-key": key}, nil)
		if key == "passwd123" {
			assertKOSyncGolden(t, r, 200, `{"authorized":"OK"}`)
		} else {
			assertKOSyncGolden(t, r, 401, `{"code":2001,"message":"Unauthorized"}`)
			require.Empty(t, r.header.Get("Retry-After"))
		}
	}
	key := md5Password("stock client password")
	assertKOSyncGolden(t, create(map[string]any{"username": "stock-client", "password": key, "metadata": map[string]any{"ignored": true}}), 201, `{"username":"stock-client"}`)
	assertKOSyncGolden(t, koSyncHTTP(t, f, "GET", "/api/ko/users/auth", nil, map[string]string{"x-auth-user": "stock-client", "x-auth-key": key}, nil), 200, `{"authorized":"OK"}`)

	for _, body := range []string{
		`{}`, `null`, `{"username":null,"password":"key"}`, `{"username":"","password":"key"}`,
		`{"username":"bad:name","password":"key"}`, `{"username":"invalid"}`, `{"username":"invalid","password":null}`,
		`{"username":"invalid","password":""}`, `{"username":4,"password":"key"}`, `{"username":"invalid","password":4}`, `{`,
	} {
		f.api.attempts = credentialLimiter{}
		assertKOSyncGolden(t, create(body), 403, `{"code":2003,"message":"Invalid request"}`)
		require.Equal(t, 2, f.count("users"))
	}
	f.cfg.RegistrationEnabled = false
	assertKOSyncGolden(t, create(`{"username":"disabled","password":"key"}`), 402, `{"code":2005,"message":"User registration is disabled."}`)
	require.Equal(t, 2, f.count("users"))
}

func TestKOSyncErrorsRequiredPresenceIsAtomic(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	headers := koHeaders()
	call := func(body any) webResponse {
		return koSyncHTTP(t, f, "PUT", "/api/ko/syncs/progress", body, headers, nil)
	}
	require.Equal(t, 200, call(map[string]any{"document": "89isjkdaj9j", "percentage": 0.32, "progress": "56", "device": "my kpw", "device_id": "original-reader"}).status)
	snapshot := func() map[string][]byte {
		out := map[string][]byte{}
		for _, table := range []string{"documents", "devices", "reading_heads", "reading_head_devices", "document_progress", "reading_receipts"} {
			rows, err := f.db.DB.Query("SELECT * FROM " + table + " ORDER BY rowid")
			require.NoError(t, err)
			columns, err := rows.Columns()
			require.NoError(t, err)
			var records [][]any
			for rows.Next() {
				values, targets := make([]any, len(columns)), make([]any, len(columns))
				for i := range values {
					targets[i] = &values[i]
				}
				require.NoError(t, rows.Scan(targets...))
				records = append(records, values)
			}
			require.NoError(t, rows.Err())
			require.NoError(t, rows.Close())
			out[table], err = json.Marshal(records)
			require.NoError(t, err)
		}
		return out
	}
	before := snapshot()
	for _, document := range []string{"89isjkdaj9j", "unwritten"} {
		for _, field := range []string{"percentage", "progress", "device"} {
			for _, kind := range []string{"missing", "null", "wrong-type"} {
				t.Run(document+"/"+field+"/"+kind, func(t *testing.T) {
					body := map[string]any{"document": document, "percentage": 0, "progress": "", "device": "Uncommitted", "device_id": "uncommitted-reader"}
					switch kind {
					case "missing":
						delete(body, field)
					case "null":
						body[field] = nil
					case "wrong-type":
						body[field] = false
					}
					assertKOSyncGolden(t, call(body), 403, `{"code":2003,"message":"Invalid request"}`)
					require.Equal(t, before, snapshot())
				})
			}
		}
	}
	for _, document := range []string{``, `,"document":null`, `,"document":""`} {
		assertKOSyncGolden(t, call(`{"percentage":0,"progress":"","device":""`+document+`}`), 403, `{"code":2004,"message":"Field 'document' not provided."}`)
		require.Equal(t, before, snapshot())
	}
	assertKOSyncGolden(t, call(`{`), 403, `{"code":2003,"message":"Invalid request"}`)
	require.Equal(t, before, snapshot())
}

func TestKOSyncDocumentIDMatchesOfficialServer(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	for _, id := range []string{"a-b", "a/b", "a%2Fb", "a b", "雪"} {
		assertKOSyncGolden(t, f.koWrite(id, "reader", 0.32, "position"), 403, `{"code":2007,"message":"Field 'document' contains characters the read route cannot serve."}`)
	}
	assertKOSyncGolden(t, f.koWrite("a:b", "reader", 0.32, "position"), 403, `{"code":2004,"message":"Field 'document' not provided."}`)
	require.Zero(t, f.count("documents"))
	require.Zero(t, f.count("devices"))
	require.Equal(t, 200, f.koWrite("Book_123", "reader", 0.32, "position").status)
	r := f.call("GET", "/api/ko/syncs/progress/Book_123", nil, koHeaders())
	require.Equal(t, 200, r.status, string(r.body))
	require.Equal(t, "Book_123", decodeWeb[map[string]any](t, r)["document"])
}

func TestKOSyncErrorsBlanksZeroAndExtrasGolden(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	for i, optional := range []struct {
		supplied bool
		id       any
	}{{false, nil}, {true, nil}, {true, ""}, {true, "reader-global"}} {
		id := optional.id
		document := fmt.Sprintf("blank%d", i)
		body := map[string]any{"document": document, "percentage": 0, "progress": "", "device": "", "metadata": map[string]any{"title": "Ignored"}, "event_id": "not-a-web-uuid", "base_revision": "not-CAS", "timestamp": "ignored-client-clock", "unknown": true}
		if optional.supplied {
			body["device_id"] = id
		}
		r := koSyncHTTP(t, f, "PUT", "/api/ko/syncs/progress", body, koHeaders(), nil)
		require.Equal(t, 200, r.status, string(r.body))
		timestamp := decodeKOTimestamp(t, r)
		r = koSyncHTTP(t, f, "GET", "/api/ko/syncs/progress/"+document, nil, koHeaders(), nil)
		expected := fmt.Sprintf(`{"document":%q,"percentage":0,"progress":"","device":"","timestamp":%d}`, document, timestamp)
		if id != nil {
			expected = expected[:len(expected)-1] + fmt.Sprintf(`,"device_id":%q}`, id)
		}
		assertKOSyncGolden(t, r, 200, expected)
	}
	assertKOSyncGolden(t, koSyncHTTP(t, f, "GET", "/api/ko/syncs/progress/unknown", nil, koHeaders(), nil), 200, `{}`)
}

func TestKOSyncErrorsExplicitHeadersOverrideCookie(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	u, err := http.NewRequest("GET", f.server.URL, nil)
	require.NoError(t, err)
	cookies := f.client.Jar.Cookies(u.URL)
	require.NotEmpty(t, cookies)
	assertKOSyncGolden(t, koSyncHTTP(t, f, "POST", "/api/ko/users/create", map[string]any{"username": "bob", "password": md5Password("password")}, nil, nil), 201, `{"username":"bob"}`)
	bob := map[string]string{"x-auth-user": "bob", "x-auth-key": md5Password("password")}
	body := `{"document":"cookieprecedence","percentage":0.32,"progress":"56","device":"my kpw","device_id":"same-reader"}`
	r := koSyncHTTP(t, f, "PUT", "/api/ko/syncs/progress", body, bob, cookies)
	require.Equal(t, 200, r.status, string(r.body))
	require.Empty(t, r.header.Values("Set-Cookie"), "reader headers must preserve the browser session and its CSRF token")
	assertKOSyncGolden(t, koSyncHTTP(t, f, "GET", "/api/ko/syncs/progress/cookieprecedence", nil, nil, cookies), 200, `{}`)
	r = koSyncHTTP(t, f, "GET", "/api/ko/syncs/progress/cookieprecedence", nil, bob, cookies)
	require.Equal(t, "56", decodeWeb[map[string]any](t, r)["progress"])
	for _, headers := range []map[string]string{
		{"x-auth-user": "bob", "x-auth-key": "wrong"}, {"x-auth-user": "bob"}, {"x-auth-key": md5Password("password")},
		{"x-auth-user": "", "x-auth-key": ""}, {"x-auth-user": ""}, {"x-auth-key": ""},
	} {
		for _, method := range []string{"GET", "PUT"} {
			path, payload := "/api/ko/users/auth", ""
			if method == "PUT" {
				path, payload = "/api/ko/syncs/progress", body
			}
			assertKOSyncGolden(t, koSyncHTTP(t, f, method, path, payload, headers, cookies), 401, `{"code":2001,"message":"Unauthorized"}`)
		}
	}
	assertKOSyncGolden(t, koSyncHTTP(t, f, "GET", "/api/ko/users/auth", nil, nil, cookies), 200, `{"authorized":"OK"}`)
	require.Equal(t, 200, koSyncHTTP(t, f, "PUT", "/api/ko/syncs/progress", body, nil, cookies).status)
	var aliceHeads, bobHeads int
	require.NoError(t, f.db.DB.QueryRow("SELECT count(*) FROM reading_heads WHERE user_id='alice'").Scan(&aliceHeads))
	require.NoError(t, f.db.DB.QueryRow("SELECT count(*) FROM reading_heads WHERE user_id='bob'").Scan(&bobHeads))
	require.Equal(t, 1, aliceHeads)
	require.Equal(t, 1, bobHeads)
}

func TestKOSyncErrorsSafeInternalAndOverload(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	f.exec(`CREATE TRIGGER private_failure BEFORE INSERT ON document_progress BEGIN SELECT RAISE(ABORT,'SELECT private path /tmp/secret'); END`)
	r := koSyncHTTP(t, f, "PUT", "/api/ko/syncs/progress", `{"document":"newdoc","percentage":0.32,"progress":"56","device":"my kpw"}`, koHeaders(), nil)
	assertKOSyncGolden(t, r, 502, `{"code":2000,"message":"Unknown server error."}`)
	require.Empty(t, r.header.Get("Retry-After"))
	require.Zero(t, f.count("reading_heads"))
	require.Zero(t, f.count("document_progress"))
	require.Zero(t, f.count("devices"))
	f.exec(`CREATE TRIGGER private_signup_failure BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT,'SELECT private signup /tmp/secret'); END`)
	assertKOSyncGolden(t, koSyncHTTP(t, f, "POST", "/api/ko/users/create", `{"username":"failed-signup","password":"key"}`, nil, nil), 502, `{"code":2000,"message":"Unknown server error."}`)
	require.Equal(t, 1, f.count("users"))
	for _, path := range []string{"/api/ko/users/auth", "/api/ko/users/create"} {
		for _, status := range []int{429, 503} {
			f.api.attempts = credentialLimiter{}
			if status == 429 {
				for i := 0; i < 10; i++ {
					require.True(t, f.api.attempts.allow("127.0.0.1"))
				}
			} else {
				for i := 0; i < cap(f.api.identitySlots); i++ {
					f.api.identitySlots <- struct{}{}
				}
			}
			method, body := "GET", ""
			if path == "/api/ko/users/create" {
				method, body = "POST", `{"username":"overloaded","password":"key"}`
			}
			r = koSyncHTTP(t, f, method, path, body, koHeaders(), nil)
			assertKOSyncGolden(t, r, status, fmt.Sprintf(`{"code":2000,"message":%q}`, http.StatusText(status)))
			require.Equal(t, "60", r.header.Get("Retry-After"))
			if status == 503 {
				for i := 0; i < cap(f.api.identitySlots); i++ {
					<-f.api.identitySlots
				}
			}
		}
	}
	f.api.attempts = credentialLimiter{}
	assertKOSyncGolden(t, koSyncHTTP(t, f, "GET", "/api/ko/users/auth", nil, koHeaders(), nil), 200, `{"authorized":"OK"}`)
	require.Equal(t, 1, f.count("users"))
}
