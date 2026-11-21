package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestHTTPSCookiesAndOriginIndependentOfHost(t *testing.T) {
	f := newWebFixture(t)
	cfg := *f.cfg
	cfg.PublicOrigin = "https://books.example:443"
	api, err := NewAPI(f.db, &cfg, os.DirFS(".."))
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	api.Handler().ServeHTTP(recorder, httptest.NewRequest("GET", cfg.PublicOrigin+"/api/v1/session", nil))
	require.Equal(t, 200, recorder.Code)
	cookies := recorder.Result().Cookies()
	require.Len(t, cookies, 1)
	cookie := cookies[0]
	require.Equal(t, "token", cookie.Name)
	require.Equal(t, "/", cookie.Path)
	require.True(t, cookie.Secure)
	require.True(t, cookie.HttpOnly)
	require.Equal(t, http.SameSiteStrictMode, cookie.SameSite)
	require.Equal(t, 604800, cookie.MaxAge)
	anonymous := decodeWeb[Session](t, webResponse{recorder.Code, recorder.Header(), recorder.Body.Bytes()})
	register := func(origin string) webResponse {
		request := httptest.NewRequest("POST", "http://backend.internal/api/v1/session/register", bytes.NewBufferString(`{"username":"alice","password":"password"}`))
		request.AddCookie(cookie)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", origin)
		request.Header.Set("X-CSRF-Token", anonymous.CsrfToken)
		recorder := httptest.NewRecorder()
		api.Handler().ServeHTTP(recorder, request)
		return webResponse{recorder.Code, recorder.Header(), recorder.Body.Bytes()}
	}
	assertProblem(t, register("https://other.example"), 403, "csrf_failed")
	response := register("https://books.example")
	require.Equal(t, http.StatusCreated, response.status, string(response.body))
}
