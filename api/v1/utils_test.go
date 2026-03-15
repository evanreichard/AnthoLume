package v1

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWriteJSON(t *testing.T) {
	w := httptest.NewRecorder()
	data := map[string]string{"test": "value"}

	writeJSON(w, http.StatusOK, data)

	if w.Header().Get("Content-Type") != "application/json" {
		t.Errorf("Expected Content-Type 'application/json', got '%s'", w.Header().Get("Content-Type"))
	}

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if resp["test"] != "value" {
		t.Errorf("Expected 'value', got '%s'", resp["test"])
	}
}

func TestWriteJSONError(t *testing.T) {
	w := httptest.NewRecorder()

	writeJSONError(w, http.StatusBadRequest, "test error")

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}

	var resp ErrorResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("Failed to unmarshal response: %v", err)
	}

	if resp.Code != http.StatusBadRequest {
		t.Errorf("Expected code 400, got %d", resp.Code)
	}

	if resp.Message != "test error" {
		t.Errorf("Expected message 'test error', got '%s'", resp.Message)
	}
}

func TestParseQueryParams(t *testing.T) {
	query := make(map[string][]string)
	query["page"] = []string{"2"}
	query["limit"] = []string{"15"}
	query["search"] = []string{"test"}

	params := parseQueryParams(query, 9)

	if params.Page != 2 {
		t.Errorf("Expected page 2, got %d", params.Page)
	}

	if params.Limit != 15 {
		t.Errorf("Expected limit 15, got %d", params.Limit)
	}

	if params.Search == nil {
		t.Fatal("Expected search to be set")
	}
}

func TestParseQueryParamsDefaults(t *testing.T) {
	query := make(map[string][]string)

	params := parseQueryParams(query, 9)

	if params.Page != 1 {
		t.Errorf("Expected page 1, got %d", params.Page)
	}

	if params.Limit != 9 {
		t.Errorf("Expected limit 9, got %d", params.Limit)
	}

	if params.Search != nil {
		t.Errorf("Expected search to be nil, got '%v'", params.Search)
	}
}

func TestPtrOf(t *testing.T) {
	value := "test"
	ptr := ptrOf(value)

	if ptr == nil {
		t.Fatal("Expected non-nil pointer")
	}

	if *ptr != "test" {
		t.Errorf("Expected 'test', got '%s'", *ptr)
	}
}