package v1

import (
	"bytes"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	argon2 "github.com/alexedwards/argon2id"
	"reichard.io/antholume/database"
)

func TestAPILogin(t *testing.T) {
	db := setupTestDB(t)
	cfg := testConfig()
	server := NewServer(db, cfg)

	// First, create a user
	createTestUser(t, db, "testuser", "testpass")

	// Test login
	reqBody := LoginRequest{
		Username: "testuser",
		Password: "testpass",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	w := httptest.NewRecorder()

	server.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp LoginResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if resp.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", resp.Username)
	}
}

func TestAPILoginInvalidCredentials(t *testing.T) {
	db := setupTestDB(t)
	cfg := testConfig()
	server := NewServer(db, cfg)

	reqBody := LoginRequest{
		Username: "testuser",
		Password: "wrongpass",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	w := httptest.NewRecorder()

	server.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("Expected 401, got %d", w.Code)
	}
}

func TestAPILogout(t *testing.T) {
	db := setupTestDB(t)
	cfg := testConfig()
	server := NewServer(db, cfg)

	// Create user and login
	createTestUser(t, db, "testuser", "testpass")

	// Login first
	reqBody := LoginRequest{Username: "testuser", Password: "testpass"}
	body, _ := json.Marshal(reqBody)
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	loginResp := httptest.NewRecorder()
	server.ServeHTTP(loginResp, loginReq)

	// Get session cookie
	cookies := loginResp.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("No session cookie returned")
	}

	// Logout
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	req.AddCookie(cookies[0])
	w := httptest.NewRecorder()

	server.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}
}

func TestAPIGetMe(t *testing.T) {
	db := setupTestDB(t)
	cfg := testConfig()
	server := NewServer(db, cfg)

	// Create user and login
	createTestUser(t, db, "testuser", "testpass")

	// Login first
	reqBody := LoginRequest{Username: "testuser", Password: "testpass"}
	body, _ := json.Marshal(reqBody)
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	loginResp := httptest.NewRecorder()
	server.ServeHTTP(loginResp, loginReq)

	// Get session cookie
	cookies := loginResp.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("No session cookie returned")
	}

	// Get me
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.AddCookie(cookies[0])
	w := httptest.NewRecorder()

	server.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", w.Code)
	}

	var resp UserData
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if resp.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", resp.Username)
	}
}

func TestAPIGetMeUnauthenticated(t *testing.T) {
	db := setupTestDB(t)
	cfg := testConfig()
	server := NewServer(db, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	w := httptest.NewRecorder()

	server.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("Expected 401, got %d", w.Code)
	}
}

func createTestUser(t *testing.T, db *database.DBManager, username, password string) {
	t.Helper()

	// MD5 hash for KOSync compatibility (matches existing system)
	md5Hash := fmt.Sprintf("%x", md5.Sum([]byte(password)))
	
	// Then argon2 hash the MD5
	hashedPassword, err := argon2.CreateHash(md5Hash, argon2.DefaultParams)
	if err != nil {
		t.Fatalf("Failed to hash password: %v", err)
	}

	authHash := "test-auth-hash"

	_, err = db.Queries.CreateUser(t.Context(), database.CreateUserParams{
		ID:       username,
		Pass:     &hashedPassword,
		AuthHash: &authHash,
		Admin:    true,
	})
	if err != nil {
		t.Fatalf("Failed to create user: %v", err)
	}
}