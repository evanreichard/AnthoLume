package v1

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"reichard.io/antholume/database"
	"reichard.io/antholume/pkg/ptr"
)

func TestAPIGetDocuments(t *testing.T) {
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

	// Get documents
	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents?page=1&limit=9", nil)
	req.AddCookie(cookies[0])
	w := httptest.NewRecorder()

	server.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp DocumentsResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if resp.Page != 1 {
		t.Errorf("Expected page 1, got %d", resp.Page)
	}

	if resp.Limit != 9 {
		t.Errorf("Expected limit 9, got %d", resp.Limit)
	}

	if resp.User.Username != "testuser" {
		t.Errorf("Expected username 'testuser', got '%s'", resp.User.Username)
	}
}

func TestAPIGetDocumentsUnauthenticated(t *testing.T) {
	db := setupTestDB(t)
	cfg := testConfig()
	server := NewServer(db, cfg)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents", nil)
	w := httptest.NewRecorder()

	server.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("Expected 401, got %d", w.Code)
	}
}

func TestAPIGetDocument(t *testing.T) {
	db := setupTestDB(t)
	cfg := testConfig()
	server := NewServer(db, cfg)

	// Create user
	createTestUser(t, db, "testuser", "testpass")

	// Create a document using UpsertDocument
	docID := "test-doc-1"
	_, err := db.Queries.UpsertDocument(t.Context(), database.UpsertDocumentParams{
		ID:       docID,
		Title:    ptr.Of("Test Document"),
		Author:   ptr.Of("Test Author"),
	})
	if err != nil {
		t.Fatalf("Failed to create document: %v", err)
	}

	// Login
	reqBody := LoginRequest{Username: "testuser", Password: "testpass"}
	body, _ := json.Marshal(reqBody)
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	loginResp := httptest.NewRecorder()
	server.ServeHTTP(loginResp, loginReq)

	cookies := loginResp.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("No session cookie returned")
	}

	// Get document
	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+docID, nil)
	req.AddCookie(cookies[0])
	w := httptest.NewRecorder()

	server.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp DocumentResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if resp.Document.ID != docID {
		t.Errorf("Expected document ID '%s', got '%s'", docID, resp.Document.ID)
	}

	if *resp.Document.Title != "Test Document" {
		t.Errorf("Expected title 'Test Document', got '%s'", *resp.Document.Title)
	}
}

func TestAPIGetDocumentNotFound(t *testing.T) {
	db := setupTestDB(t)
	cfg := testConfig()
	server := NewServer(db, cfg)

	// Create user and login
	createTestUser(t, db, "testuser", "testpass")

	reqBody := LoginRequest{Username: "testuser", Password: "testpass"}
	body, _ := json.Marshal(reqBody)
	loginReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	loginResp := httptest.NewRecorder()
	server.ServeHTTP(loginResp, loginReq)

	cookies := loginResp.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("No session cookie returned")
	}

	// Get non-existent document
	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/non-existent", nil)
	req.AddCookie(cookies[0])
	w := httptest.NewRecorder()

	server.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("Expected 404, got %d", w.Code)
	}
}