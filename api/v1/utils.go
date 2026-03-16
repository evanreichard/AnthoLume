package v1

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// writeJSON writes a JSON response (deprecated - used by tests only)
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to encode response")
	}
}

// writeJSONError writes a JSON error response (deprecated - used by tests only)
func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, ErrorResponse{
		Code:    status,
		Message: message,
	})
}

// QueryParams represents parsed query parameters (deprecated - used by tests only)
type QueryParams struct {
	Page   int64
	Limit  int64
	Search *string
}

// parseQueryParams parses URL query parameters (deprecated - used by tests only)
func parseQueryParams(query url.Values, defaultLimit int64) QueryParams {
	page, _ := strconv.ParseInt(query.Get("page"), 10, 64)
	if page == 0 {
		page = 1
	}
	limit, _ := strconv.ParseInt(query.Get("limit"), 10, 64)
	if limit == 0 {
		limit = defaultLimit
	}
	search := query.Get("search")
	var searchPtr *string
	if search != "" {
		searchPtr = ptrOf("%" + search + "%")
	}
	return QueryParams{
		Page:   page,
		Limit:  limit,
		Search: searchPtr,
	}
}

// ptrOf returns a pointer to the given value
func ptrOf[T any](v T) *T {
	return &v
}

// parseTime parses a string to time.Time
func parseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	if t.IsZero() {
		t, _ = time.Parse("2006-01-02T15:04:05", s)
	}
	return t
}

// parseTimePtr parses an interface{} (from SQL) to *time.Time
func parseTimePtr(v interface{}) *time.Time {
	if v == nil {
		return nil
	}
	if s, ok := v.(string); ok {
		t := parseTime(s)
		if t.IsZero() {
			return nil
		}
		return &t
	}
	return nil
}