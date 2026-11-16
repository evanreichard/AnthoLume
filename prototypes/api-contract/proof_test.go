package contract

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/gorillamux"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
)

func syntheticEPUB(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, f := range []struct{ name, body string }{{"mimetype", "application/epub+zip"}, {"META-INF/container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`}, {"content.opf", `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">proof</dc:identifier><dc:title>Proof</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`}, {"chapter.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Proof</title></head><body><p>Synthetic book.</p></body></html>`}} {
		p, err := w.CreateHeader(&zip.FileHeader{Name: f.name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = io.WriteString(p, f.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

type harness struct {
	t            *testing.T
	store        *Store
	server       *httptest.Server
	cookies      map[string]*http.Cookie
	epub         []byte
	path         string
	sessionStore sessions.Store
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	gin.SetMode(gin.TestMode)
	h := &harness{t: t, path: filepath.Join(t.TempDir(), "proof.db"), epub: syntheticEPUB(t), cookies: map[string]*http.Cookie{}}
	var err error
	h.store, err = OpenStore(h.path, true)
	if err != nil {
		t.Fatal(err)
	}
	h.sessionStore = cookie.NewStore([]byte("01234567890123456789012345678901"))
	h.sessionStore.Options(sessions.Options{Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode, MaxAge: 3600})
	for _, user := range []string{"alice", "bob", "admin", "expired"} {
		h.cookies[user] = h.issue(user)
	}
	h.start()
	t.Cleanup(func() { h.server.Close(); h.store.DB.Close() })
	return h
}
func (h *harness) withTest(t *testing.T) *harness {
	copy := *h
	copy.t = t
	return &copy
}
func (h *harness) issue(user string) *http.Cookie {
	// Fixture Bootstrap - Credentials/session issuance are deliberately outside the representative API.
	r := gin.New()
	r.Use(sessions.Sessions("proof_session", h.sessionStore))
	r.GET("/", func(c *gin.Context) {
		s := sessions.Default(c)
		s.Set("user", user)
		s.Set("csrf", "csrf-"+user)
		if err := s.Save(); err != nil {
			h.t.Fatal(err)
		}
		c.Status(204)
	})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "https://proof.invalid/", nil))
	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		h.t.Fatal("missing cookie")
	}
	return cookies[0]
}
func (h *harness) start() {
	r, err := NewRouter(h.store, h.sessionStore, h.epub)
	if err != nil {
		h.t.Fatal(err)
	}
	h.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, rq *http.Request) {
		if rq.Header.Get("X-Lose-Response") == "1" {
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, rq)
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				h.t.Error(err)
				return
			}
			conn.Close()
			return
		}
		r.ServeHTTP(w, rq)
	}))
}
func (h *harness) request(user, method, path, media string, body []byte, headers map[string]string) (*http.Response, []byte, error) {
	req, err := http.NewRequest(method, h.server.URL+path, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	if user != "" {
		req.AddCookie(h.cookies[user])
		req.Header.Set("X-CSRF-Token", "csrf-"+user)
	}
	req.Header.Set("Origin", proofOrigin)
	if media != "" {
		req.Header.Set("Content-Type", media)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := h.server.Client().Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	return res, b, err
}
func (h *harness) call(user, method, path, media string, body []byte, status int, headers map[string]string) []byte {
	h.t.Helper()
	res, b, err := h.request(user, method, path, media, body, headers)
	if err != nil {
		h.t.Fatal(err)
	}
	if res.StatusCode != status {
		h.t.Fatalf("%s %s: got %d want %d: %s", method, path, res.StatusCode, status, b)
	}
	if err = validateResponse(method, path, res, b); err != nil {
		h.t.Fatalf("response contract: %v; %s", err, b)
	}
	if status >= 400 {
		if res.Header.Get("Content-Type") != "application/problem+json" {
			h.t.Fatal("wrong problem media")
		}
		var p Problem
		if err = json.Unmarshal(b, &p); err != nil || p.Status != status || p.Code == "" || p.Detail == "" {
			h.t.Fatalf("bad problem: %s", b)
		}
		for _, secret := range []string{"/private/", "private-auth", "not-a-credential", "SELECT ", "sqlite"} {
			if bytes.Contains(b, []byte(secret)) {
				h.t.Fatal("leaked internal data")
			}
		}
	}
	return b
}
func validateResponse(method, path string, res *http.Response, b []byte) error {
	spec, err := GetSwagger()
	if err != nil {
		return err
	}
	router, err := gorillamux.NewRouter(spec)
	if err != nil {
		return err
	}
	req, _ := http.NewRequest(method, "http://example.invalid"+path, nil)
	route, params, err := router.FindRoute(req)
	if err != nil {
		return err
	}
	input := &openapi3filter.ResponseValidationInput{RequestValidationInput: &openapi3filter.RequestValidationInput{Request: req, PathParams: params, Route: route}, Status: res.StatusCode, Header: res.Header, Body: io.NopCloser(bytes.NewReader(b)), Options: &openapi3filter.Options{IncludeResponseStatus: true}}
	return openapi3filter.ValidateResponse(context.Background(), input)
}
func progress(id, revision string, fraction float64) []byte {
	return []byte(fmt.Sprintf(`{"event_id":%q,"document_id":"book-a","device_id":"a-device","base_revision":%q,"fraction":%g,"position":"/body/DocFragment[1]/body/p.3","observed_at":"2026-01-02T03:04:05Z"}`, id, revision, fraction))
}
func activity(id string) []byte {
	return []byte(fmt.Sprintf(`{"event_id":%q,"document_id":"book-a","device_id":"a-device","start_time":"2026-01-02T03:04:05Z","duration":30,"start_fraction":0.2,"end_fraction":0.3}`, id))
}
func (h *harness) scalar(query string) int {
	h.t.Helper()
	var n int
	if err := h.store.DB.QueryRow(query).Scan(&n); err != nil {
		h.t.Fatal(err)
	}
	return n
}
func (h *harness) assertCount(table string, n int) {
	h.t.Helper()
	if got := h.scalar("SELECT count(*) FROM " + table); got != n {
		h.t.Fatalf("%s count=%d want=%d", table, got, n)
	}
}

func TestDocumentsAndSecurity(t *testing.T) {
	h := newHarness(t)
	h.call("", "GET", "/api/v1/documents", "", nil, 401, nil)
	h.call("expired", "GET", "/api/v1/documents", "", nil, 401, nil)
	h.cookies["alice"].Value += "x"
	h.call("alice", "GET", "/api/v1/documents", "", nil, 401, nil)
	h.cookies["alice"] = h.issue("alice")
	first := h.call("alice", "GET", "/api/v1/documents?page=1&page_size=1", "", nil, 200, nil)
	var page DocumentPage
	if err := json.Unmarshal(first, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Id != "book-a" || page.Items[0].Title != nil || page.Items[0].Author == nil || *page.Items[0].Author != "Synthetic Author" || page.NextPage == nil || *page.NextPage != 2 || page.Total != 2 {
		t.Fatalf("unsafe/unexpected DTO: %s", first)
	}
	second := h.call("alice", "GET", "/api/v1/documents?page=2&page_size=1", "", nil, 200, nil)
	if !bytes.Contains(second, []byte(`"author":null`)) || !bytes.Contains(second, []byte(`"next_page":null`)) {
		t.Fatal(string(second))
	}
	empty := h.call("alice", "GET", "/api/v1/documents?page=3&page_size=1", "", nil, 200, nil)
	if !bytes.Contains(empty, []byte(`"items":[]`)) {
		t.Fatal(string(empty))
	}
	for _, q := range []string{"page=0", "page_size=101", "page=no", "page=1000001"} {
		h.call("alice", "GET", "/api/v1/documents?"+q, "", nil, 400, nil)
	}
	h.call("alice", "GET", "/api/v1/admin/probe", "", nil, 403, nil)
	h.call("admin", "GET", "/api/v1/admin/probe", "", nil, 200, nil)
	if _, err := h.store.DB.Exec("UPDATE users SET admin=0 WHERE id='admin'"); err != nil {
		t.Fatal(err)
	}
	h.call("admin", "GET", "/api/v1/admin/probe", "", nil, 403, nil)
	for _, headers := range []map[string]string{{"Origin": "https://evil.invalid"}, {"Origin": ""}, {"X-CSRF-Token": ""}, {"X-CSRF-Token": "csrf-bob"}} {
		h.call("alice", "POST", "/api/v1/me/reading-progress", "application/json", progress("csrf", "0", .2), 403, headers)
	}
	h.assertCount("proof_receipts", 0)
}

func TestJSONValidation(t *testing.T) {
	h := newHarness(t)
	valid := string(progress("validate", "0", .5))
	cases := []struct {
		name, body, media string
		status            int
	}{
		{"malformed", `{"event_id":`, "application/json", 400},
		{"missing", strings.Replace(valid, `"fraction":0.5,`, "", 1), "application/json", 400},
		{"null", strings.Replace(valid, `"fraction":0.5`, `"fraction":null`, 1), "application/json", 400},
		{"wrong-case", strings.Replace(valid, `"fraction":0.5`, `"Fraction":2`, 1), "application/json", 400},
		{"case-shadow", strings.Replace(valid, `"fraction":0.5`, `"fraction":0.5,"Fraction":2`, 1), "application/json", 400},
		{"duplicate", strings.Replace(valid, `"fraction":0.5`, `"fraction":2,"fraction":0.5`, 1), "application/json", 400},
		{"escaped-duplicate", strings.Replace(valid, `"fraction":0.5`, `"fraction":2,"\u0066raction":0.5`, 1), "application/json", 400},
		{"unknown", strings.Replace(valid, `"fraction":0.5`, `"fraction":0.5,"extra":true`, 1), "application/json", 400},
		{"high", string(progress("x", "0", 1.1)), "application/json", 400},
		{"negative", string(progress("x", "0", -.1)), "application/json", 400},
		{"nan", strings.Replace(valid, "0.5", "NaN", 1), "application/json", 400},
		{"infinite", strings.Replace(valid, "0.5", "1e999", 1), "application/json", 400},
		{"empty-position", strings.Replace(valid, `/body/DocFragment[1]/body/p.3`, "", 1), "application/json", 400},
		{"position-limit", strings.Replace(valid, `/body/DocFragment[1]/body/p.3`, strings.Repeat("p", 4097), 1), "application/json", 400},
		{"time", strings.Replace(valid, "2026-01-02T03:04:05Z", "yesterday", 1), "application/json", 400},
		{"revision", string(progress("x", "01", .3)), "application/json", 400},
		{"trailing", valid + ` {}`, "application/json", 400},
		{"oversized", strings.Repeat(" ", JSONLimit) + valid, "application/json", 413},
		{"wrong-media", valid, "text/plain", 415},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := h.withTest(t)
			h.call("alice", "POST", "/api/v1/me/reading-progress", tc.media, []byte(tc.body), tc.status, nil)
			h.assertCount("proof_receipts", 0)
			h.assertCount("proof_heads", 0)
			h.assertCount("document_progress", 0)
		})
	}
	h.call("alice", "POST", "/api/v1/me/reading-progress", "application/json", []byte(strings.Replace(valid, "a-device", "b-device", 1)), 403, nil)
	h.call("alice", "POST", "/api/v1/me/reading-progress", "application/json", []byte(strings.Replace(valid, "book-a", "unknown", 1)), 403, nil)
	h.call("alice", "POST", "/api/v1/me/activity", "application/json", []byte(strings.Replace(string(activity("bad")), `"duration":30`, `"duration":86401`, 1)), 400, nil)
	h.call("alice", "POST", "/api/v1/me/activity", "application/json", []byte(strings.Replace(string(activity("bad")), `"end_fraction":0.3`, `"end_fraction":0.1`, 1)), 400, nil)
	h.assertCount("activity", 0)
	h.assertCount("proof_receipts", 0)
	h.call("alice", "POST", "/api/v1/me/reading-progress", "application/json", []byte(valid), 200, nil)
}

func TestProgressReceiptsCASAndKO(t *testing.T) {
	h := newHarness(t)
	path := "/api/v1/me/reading-progress"
	first := h.call("alice", "POST", path, "application/json", progress("p1", "0", .8), 200, nil)
	if !bytes.Contains(first, []byte(`"revision":"1"`)) {
		t.Fatal(string(first))
	}
	equivalent := bytes.ReplaceAll(progress("p1", "0", .8), []byte("2026-01-02T03:04:05Z"), []byte("2026-01-02T04:04:05+01:00"))
	equivalent = bytes.ReplaceAll(equivalent, []byte(`"fraction":0.8`), []byte(`"fraction":0.8000`))
	if replay := h.call("alice", "POST", path, "application/json", equivalent, 200, nil); !bytes.Equal(first, replay) {
		t.Fatal("normalized retry changed identity")
	}
	h.call("alice", "POST", path, "application/json", progress("p1", "0", .7), 409, nil)
	back := h.call("alice", "POST", path, "application/json", progress("back", "1", .2), 200, nil)
	if !bytes.Contains(back, []byte(`"revision":"2"`)) {
		t.Fatal(string(back))
	}
	stale := h.call("alice", "POST", path, "application/json", progress("stale", "0", .9), 409, nil)
	if !bytes.Contains(stale, []byte(`"current_revision":"2"`)) {
		t.Fatal(string(stale))
	}
	receiptsBeforeKO := h.scalar("SELECT count(*) FROM proof_receipts")
	h.koHTTP("/ko/original.text().4", .1, 200)
	h.assertKORow(.1, "/ko/original.text().4")
	h.assertCount("proof_receipts", receiptsBeforeKO)
	if h.scalar("SELECT revision FROM proof_heads WHERE user_id='alice' AND document_id='book-a'") != 3 {
		t.Fatal("KO did not advance same head")
	}
	h.call("alice", "POST", path, "application/json", progress("after-ko", "2", .9), 409, nil)
	if replay := h.call("alice", "POST", path, "application/json", progress("stale", "0", .9), 409, nil); !bytes.Equal(stale, replay) {
		t.Fatal("conflict outcome changed")
	}
	if replay := h.call("alice", "POST", path, "application/json", progress("p1", "0", .8), 200, nil); !bytes.Equal(first, replay) {
		t.Fatal("old acknowledgement changed")
	}
	resolved := h.call("alice", "POST", path, "application/json", progress("explicit-local", "3", .05), 200, nil)
	if !bytes.Contains(resolved, []byte(`"revision":"4"`)) {
		t.Fatal(string(resolved))
	}
	var fraction float64
	var position string
	if err := h.store.DB.QueryRow("SELECT percentage,progress FROM document_progress WHERE device_id='a-device'").Scan(&fraction, &position); err != nil {
		t.Fatal(err)
	}
	if fraction != .05 || position != "/body/DocFragment[1]/body/p.3" {
		t.Fatalf("position changed: %g %s", fraction, position)
	}
	h.assertCount("proof_heads", 1)
	if h.scalar("SELECT revision FROM proof_heads WHERE user_id='alice'") != 4 {
		t.Fatal("wrong shared head")
	}
	bob := bytes.ReplaceAll(progress("p1", "0", .4), []byte("a-device"), []byte("b-device"))
	h.call("bob", "POST", path, "application/json", bob, 200, nil)
	if h.scalar("SELECT revision FROM proof_heads WHERE user_id='bob'") != 1 {
		t.Fatal("cross-account head")
	}
	h.call("alice", "POST", "/api/v1/me/activity", "application/json", activity("p1"), 409, nil)
}

func TestLostResponseReopenAndActivityDedup(t *testing.T) {
	h := newHarness(t)
	for _, tc := range []struct {
		path string
		body []byte
	}{{"/api/v1/me/activity", activity("lost-activity")}, {"/api/v1/me/reading-progress", progress("lost-progress", "0", .6)}} {
		if _, _, err := h.request("alice", "POST", tc.path, "application/json", tc.body, map[string]string{"X-Lose-Response": "1"}); err == nil {
			t.Fatal("response should be lost")
		}
	}
	h.assertCount("proof_receipts", 2)
	h.assertCount("activity", 1)
	h.assertCount("document_progress", 1)
	h.server.Close()
	if err := h.store.DB.Close(); err != nil {
		t.Fatal(err)
	}
	var err error
	h.store, err = OpenStore(h.path, false)
	if err != nil {
		t.Fatal(err)
	}
	h.start()
	a := h.call("alice", "POST", "/api/v1/me/activity", "application/json", activity("lost-activity"), 200, nil)
	for range 3 {
		if b := h.call("alice", "POST", "/api/v1/me/activity", "application/json", activity("lost-activity"), 200, nil); !bytes.Equal(a, b) {
			t.Fatal("receipt not stable")
		}
	}
	h.call("alice", "POST", "/api/v1/me/reading-progress", "application/json", progress("lost-progress", "0", .6), 200, nil)
	changed := bytes.Replace(activity("lost-activity"), []byte(`"duration":30`), []byte(`"duration":31`), 1)
	h.call("alice", "POST", "/api/v1/me/activity", "application/json", changed, 409, nil)
	h.assertCount("proof_receipts", 2)
	h.assertCount("activity", 1)
	if h.scalar("SELECT sum(duration) FROM activity") != 30 {
		t.Fatal("duplicate credit")
	}
	if h.scalar("SELECT revision FROM proof_heads") != 1 {
		t.Fatal("duplicate revision")
	}
}

func TestReceiptFailureRollsBack(t *testing.T) {
	h := newHarness(t)
	if _, err := h.store.DB.Exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON proof_receipts BEGIN SELECT RAISE(ABORT,'injected failure'); END;`); err != nil {
		t.Fatal(err)
	}
	h.call("alice", "POST", "/api/v1/me/activity", "application/json", activity("atomic-a"), 500, nil)
	h.call("alice", "POST", "/api/v1/me/reading-progress", "application/json", progress("atomic-p", "0", .4), 500, nil)
	for _, table := range []string{"proof_receipts", "proof_heads", "activity", "document_progress"} {
		h.assertCount(table, 0)
	}
	if _, err := h.store.DB.Exec("DROP TRIGGER fail_receipt"); err != nil {
		t.Fatal(err)
	}
	h.call("alice", "POST", "/api/v1/me/activity", "application/json", activity("atomic-a"), 200, nil)
	h.call("alice", "POST", "/api/v1/me/reading-progress", "application/json", progress("atomic-p", "0", .4), 200, nil)
}

func TestConcurrentCASAndDedup(t *testing.T) {
	h := newHarness(t)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := range 2 {
		wg.Go(func() {
			res, _, err := h.request("alice", "POST", "/api/v1/me/reading-progress", "application/json", progress(fmt.Sprintf("race-%d", i), "0", .4), nil)
			if err != nil {
				t.Error(err)
				return
			}
			codes <- res.StatusCode
		})
	}
	wg.Wait()
	close(codes)
	successes, conflicts := 0, 0
	for c := range codes {
		if c == 200 {
			successes++
		} else if c == 409 {
			conflicts++
		} else {
			t.Fatalf("unexpected status %d", c)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatal("CAS did not isolate writers")
	}
	for range 2 {
		wg.Go(func() {
			res, body, err := h.request("alice", "POST", "/api/v1/me/activity", "application/json", activity("concurrent"), nil)
			if err != nil {
				t.Error(err)
				return
			}
			if res.StatusCode != 200 {
				t.Errorf("concurrent activity: %d %s", res.StatusCode, body)
			}
		})
	}
	wg.Wait()
	h.assertCount("activity", 1)
}

func multipartBody(t *testing.T, data []byte, partMedia string, extra bool) ([]byte, string) {
	t.Helper()
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="file"; filename="../../evil.epub"`)
	header.Set("Content-Type", partMedia)
	p, err := w.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	p.Write(data)
	if extra {
		p, _ = w.CreatePart(header)
		p.Write([]byte("extra"))
	}
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes(), w.FormDataContentType()
}
func TestBinaryBoundaries(t *testing.T) {
	h := newHarness(t)
	h.call("", "GET", "/api/v1/documents/book-a/file", "", nil, 401, nil)
	h.call("alice", "GET", "/api/v1/documents/missing/file", "", nil, 404, nil)
	h.call("alice", "GET", "/api/v1/documents/deleted/file", "", nil, 404, nil)
	res, b, err := h.request("alice", "GET", "/api/v1/documents/book-a/file", "", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateResponse("GET", "/api/v1/documents/book-a/file", res, b); err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "application/epub+zip" || res.ContentLength != int64(len(h.epub)) || res.Header.Get("Content-Disposition") != `attachment; filename="synthetic.epub"` || res.Header.Get("Cache-Control") != "private, no-store" || !bytes.Equal(b, h.epub) {
		t.Fatalf("bad download: %v", res.Header)
	}
	for _, tc := range []struct {
		name   string
		data   []byte
		media  string
		extra  bool
		status int
	}{{"valid", h.epub, "application/epub+zip", false, 200}, {"file-limit", bytes.Repeat([]byte("x"), FileLimit+1), "application/epub+zip", false, 413}, {"wire-limit", bytes.Repeat([]byte("x"), WireLimit+1), "application/epub+zip", false, 413}, {"wrong-part", h.epub, "text/plain", false, 415}, {"invalid-zip", []byte("not epub"), "application/epub+zip", false, 400}, {"duplicate-part", h.epub, "application/epub+zip", true, 400}} {
		t.Run(tc.name, func(t *testing.T) {
			h := h.withTest(t)
			body, media := multipartBody(t, tc.data, tc.media, tc.extra)
			h.call("alice", "POST", "/api/v1/documents/upload", media, body, tc.status, nil)
		})
	}
	body, media := multipartBody(t, h.epub, "application/epub+zip", false)
	h.call("alice", "POST", "/api/v1/documents/upload", media, body, 403, map[string]string{"X-CSRF-Token": ""})
	h.call("alice", "POST", "/api/v1/documents/upload", "application/json", []byte("{}"), 415, nil)
	h.call("alice", "POST", "/api/v1/documents/upload", "multipart/form-data; boundary=bad", []byte("broken"), 400, nil)
	h.assertCount("documents", 3)
}

func TestResponseContractSensitivity(t *testing.T) {
	res := &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}}
	good := []byte(`{"items":[],"page":1,"page_size":9,"total":0,"next_page":null}`)
	if err := validateResponse("GET", "/api/v1/documents", res, good); err != nil {
		t.Fatal(err)
	}
	for _, b := range [][]byte{[]byte(`{"items":null,"page":1,"page_size":9,"total":0,"next_page":null}`), []byte(`{"items":[],"page":1,"page_size":101,"total":0,"next_page":null}`), []byte(`{"items":[{"id":"x","title":null,"author":null,"basepath":"private"}],"page":1,"page_size":9,"total":1,"next_page":null}`)} {
		if err := validateResponse("GET", "/api/v1/documents", res, b); err == nil {
			t.Fatalf("invalid response accepted: %s", b)
		}
	}
}
