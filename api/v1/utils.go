package v1

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
)

// writeJSON writes a JSON response
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to encode response")
	}
}

// writeJSONError writes a JSON error response
func writeJSONError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, ErrorResponse{
		Code:    status,
		Message: message,
	})
}

// QueryParams represents parsed query parameters
type QueryParams struct {
	Page  int64
	Limit int64
	Search *string
}

// parseQueryParams parses URL query parameters
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