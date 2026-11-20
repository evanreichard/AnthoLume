package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTrustedProxiesScopeCredentialRateLimit(t *testing.T) {
	f := newWebFixture(t)
	for _, tc := range []struct {
		name    string
		proxies []string
		peer    string
		want    int
	}{
		{"not configured", nil, "192.0.2.10:1234", http.StatusTooManyRequests},
		{"trusted address", []string{"192.0.2.10"}, "192.0.2.10:1234", http.StatusUnauthorized},
		{"trusted CIDR", []string{"2001:db8:1::/64"}, "[2001:db8:1::10]:1234", http.StatusUnauthorized},
		{"untrusted peer", []string{"192.0.2.10"}, "192.0.2.11:1234", http.StatusTooManyRequests},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := *f.cfg
			cfg.TrustedProxies = tc.proxies
			app, err := NewAPI(f.db, &cfg, os.DirFS(".."))
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, app.Stop()) })
			attempt := func(clientIP string) int {
				req := httptest.NewRequest(http.MethodGet, "/api/opds", nil)
				req.RemoteAddr = tc.peer
				req.Header.Set("X-Forwarded-For", clientIP)
				req.SetBasicAuth("unknown", "wrong")
				response := httptest.NewRecorder()
				app.Handler().ServeHTTP(response, req)
				return response.Code
			}
			for i := 0; i < 10; i++ {
				require.Equal(t, http.StatusUnauthorized, attempt("198.51.100.1"))
			}
			require.Equal(t, http.StatusTooManyRequests, attempt("198.51.100.1"))
			require.Equal(t, tc.want, attempt("198.51.100.2"))
		})
	}
}

func TestInvalidTrustedProxiesRejectStartup(t *testing.T) {
	f := newWebFixture(t)
	cfg := *f.cfg
	cfg.TrustedProxies = []string{"192.0.2.10", "proxy.example"}
	_, err := NewAPI(f.db, &cfg, os.DirFS(".."))
	require.ErrorContains(t, err, "invalid TRUSTED_PROXIES")
}
