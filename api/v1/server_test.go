package v1

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

func TestNewServer(t *testing.T) {
	db := setupTestDB(t)
	cfg := testConfig()

	server := NewServer(db, cfg)

	if server == nil {
		t.Fatal("NewServer returned nil")
	}

	if server.mux == nil {
		t.Fatal("Server mux is nil")
	}

	if server.db == nil {
		t.Fatal("Server db is nil")
	}

	if server.cfg == nil {
		t.Fatal("Server cfg is nil")
	}
}

func TestServerServeHTTP(t *testing.T) {
	db := setupTestDB(t)
	cfg := testConfig()

	server := NewServer(db, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	w := httptest.NewRecorder()

	server.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("Expected 401 for unauthenticated request, got %d", w.Code)
	}
}

func setupTestDB(t *testing.T) *database.DBManager {
	t.Helper()

	cfg := testConfig()
	cfg.DBType = "memory"

	return database.NewMgr(cfg)
}

func testConfig() *config.Config {
	return &config.Config{
		ListenPort:     "8080",
		DBType:         "memory",
		DBName:         "test",
		ConfigPath:     "/tmp",
		CookieAuthKey:  "test-auth-key-32-bytes-long-enough",
		CookieEncKey:   "0123456789abcdef",  // Exactly 16 bytes
		CookieSecure:   false,
		CookieHTTPOnly: true,
		Version:        "test",
		DemoMode:       false,
		RegistrationEnabled: true,
	}
}