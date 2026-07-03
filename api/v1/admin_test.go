package v1

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	argon2 "github.com/alexedwards/argon2id"
	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

func createAdminTestUser(t *testing.T, db *database.DBManager, username, password string) {
	t.Helper()

	md5Hash := fmt.Sprintf("%x", md5.Sum([]byte(password)))
	hashedPassword, err := argon2.CreateHash(md5Hash, argon2.DefaultParams)
	require.NoError(t, err)

	authHash := "test-auth-hash"
	_, err = db.Queries.CreateUser(context.Background(), database.CreateUserParams{
		ID:       username,
		Pass:     &hashedPassword,
		AuthHash: &authHash,
		Admin:    true,
	})
	require.NoError(t, err)
}

func loginAdminTestUser(t *testing.T, srv *Server, username, password string) *http.Cookie {
	t.Helper()

	body, err := json.Marshal(LoginRequest{Username: username, Password: password})
	require.NoError(t, err)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	cookies := w.Result().Cookies()
	require.Len(t, cookies, 1)

	return cookies[0]
}

func TestGetLogsPagination(t *testing.T) {
	configPath := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(configPath, "logs"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(configPath, "logs", "antholume.log"), []byte(
		"{\"level\":\"info\",\"msg\":\"one\"}\n"+
			"plain two\n"+
			"{\"level\":\"error\",\"msg\":\"three\"}\n"+
			"plain four\n",
	), 0o644))

	cfg := &config.Config{
		ListenPort:          "8080",
		DBType:              "memory",
		DBName:              "test",
		ConfigPath:          configPath,
		CookieAuthKey:       "test-auth-key-32-bytes-long-enough",
		CookieEncKey:        "0123456789abcdef",
		CookieSecure:        false,
		CookieHTTPOnly:      true,
		Version:             "test",
		DemoMode:            false,
		RegistrationEnabled: true,
	}

	db := database.NewMgr(cfg)
	srv := NewServer(db, cfg, nil)
	createAdminTestUser(t, db, "admin", "password")
	cookie := loginAdminTestUser(t, srv, "admin", "password")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/logs?page=2&limit=2", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var resp LogsResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.NotNil(t, resp.Logs)
	require.Len(t, *resp.Logs, 2)
	require.NotNil(t, resp.Page)
	require.Equal(t, int64(2), *resp.Page)
	require.NotNil(t, resp.Limit)
	require.Equal(t, int64(2), *resp.Limit)
	require.NotNil(t, resp.Total)
	require.Equal(t, int64(4), *resp.Total)
	require.Nil(t, resp.NextPage)
	require.NotNil(t, resp.PreviousPage)
	require.Equal(t, int64(1), *resp.PreviousPage)
	require.Contains(t, (*resp.Logs)[0], "three")
	require.Contains(t, (*resp.Logs)[1], "plain four")
}

func TestGetLogsPaginationWithBasicFilter(t *testing.T) {
	configPath := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(configPath, "logs"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(configPath, "logs", "antholume.log"), []byte(
		"{\"level\":\"info\",\"msg\":\"match-1\"}\n"+
			"{\"level\":\"info\",\"msg\":\"skip\"}\n"+
			"plain match-2\n"+
			"{\"level\":\"info\",\"msg\":\"match-3\"}\n",
	), 0o644))

	cfg := &config.Config{
		ListenPort:          "8080",
		DBType:              "memory",
		DBName:              "test",
		ConfigPath:          configPath,
		CookieAuthKey:       "test-auth-key-32-bytes-long-enough",
		CookieEncKey:        "0123456789abcdef",
		CookieSecure:        false,
		CookieHTTPOnly:      true,
		Version:             "test",
		DemoMode:            false,
		RegistrationEnabled: true,
	}

	db := database.NewMgr(cfg)
	srv := NewServer(db, cfg, nil)
	createAdminTestUser(t, db, "admin", "password")
	cookie := loginAdminTestUser(t, srv, "admin", "password")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/logs?filter=%22match%22&page=1&limit=2", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)

	var resp LogsResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	require.NotNil(t, resp.Logs)
	require.Len(t, *resp.Logs, 2)
	require.NotNil(t, resp.Total)
	require.Equal(t, int64(3), *resp.Total)
	require.NotNil(t, resp.NextPage)
	require.Equal(t, int64(2), *resp.NextPage)
}
