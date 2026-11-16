package contract

import (
	"bytes"
	"net/http/httptest"
	"testing"
)

func TestConfiguredOrigin(t *testing.T) {
	h := newHarness(t)
	for _, origin := range []string{"", "*", "null", "https://*.invalid", "https://user:pass@proof.invalid", "https://proof.invalid/", "https://proof.invalid/path", "https://proof.invalid?x=1", "https://proof.invalid#fragment", "ftp://proof.invalid"} {
		if _, err := NewRouterWithOrigin(h.store, h.sessionStore, h.epub, origin); err == nil {
			t.Fatalf("unsafe configured origin accepted: %q", origin)
		}
	}
	const configured = "http://127.0.0.1:18587"
	router, err := NewRouterWithOrigin(h.store, h.sessionStore, h.epub, configured)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		origin string
		status int
	}{{"", 403}, {proofOrigin, 403}, {configured + ".evil.invalid", 403}, {"null", 403}, {configured, 200}} {
		request := httptest.NewRequest("POST", configured+"/api/v1/me/reading-progress", bytes.NewReader(progress("configured", "0", .2)))
		request.AddCookie(h.cookies["alice"])
		request.Header.Set("Origin", tc.origin)
		request.Header.Set("X-CSRF-Token", "csrf-alice")
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != tc.status {
			t.Fatalf("origin %q: %d %s", tc.origin, response.Code, response.Body.String())
		}
		if err := validateResponse("POST", "/api/v1/me/reading-progress", response.Result(), response.Body.Bytes()); err != nil {
			t.Fatal(err)
		}
	}
	h.assertCount("proof_receipts", 1)
}
