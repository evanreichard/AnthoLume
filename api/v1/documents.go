package v1

import (
	"net/http"
	"strconv"
	"strings"

	"reichard.io/antholume/database"
	"reichard.io/antholume/pkg/ptr"
)

// apiGetDocuments handles GET /api/v1/documents
// Deprecated: Use GetDocuments with DocumentListRequest instead
func (s *Server) apiGetDocuments(w http.ResponseWriter, r *http.Request) {
	// Parse query params
	query := r.URL.Query()
	page, _ := strconv.ParseInt(query.Get("page"), 10, 64)
	if page == 0 {
		page = 1
	}
	limit, _ := strconv.ParseInt(query.Get("limit"), 10, 64)
	if limit == 0 {
		limit = 9
	}
	search := query.Get("search")

	// Get auth from context
	auth, ok := r.Context().Value("auth").(authData)
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	// Build query
	var queryPtr *string
	if search != "" {
		queryPtr = ptr.Of("%" + search + "%")
	}

	// Query database
	rows, err := s.db.Queries.GetDocumentsWithStats(
		r.Context(),
		database.GetDocumentsWithStatsParams{
			UserID:  auth.UserName,
			Query:   queryPtr,
			Deleted: ptr.Of(false),
			Offset:  (page - 1) * limit,
			Limit:   limit,
		},
	)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Calculate pagination
	total := int64(len(rows))
	var nextPage *int64
	var previousPage *int64
	if page*limit < total {
		nextPage = ptr.Of(page + 1)
	}
	if page > 1 {
		previousPage = ptr.Of(page - 1)
	}

	// Get word counts
	wordCounts := make([]WordCount, 0, len(rows))
	for _, row := range rows {
		if row.Words != nil {
			wordCounts = append(wordCounts, WordCount{
				DocumentID: row.ID,
				Count:      *row.Words,
			})
		}
	}

	// Return response
	writeJSON(w, http.StatusOK, DocumentsResponse{
		Documents:    rows,
		Total:        total,
		Page:         page,
		Limit:        limit,
		NextPage:     nextPage,
		PreviousPage: previousPage,
		Search:       ptr.Of(search),
		User:         UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
		WordCounts:   wordCounts,
	})
}

// apiGetDocument handles GET /api/v1/documents/:id
// Deprecated: Use GetDocument with DocumentRequest instead
func (s *Server) apiGetDocument(w http.ResponseWriter, r *http.Request) {
	// Extract ID from URL path
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/documents/")
	id := strings.TrimPrefix(path, "/")

	if id == "" {
		writeJSONError(w, http.StatusBadRequest, "Document ID required")
		return
	}

	// Get auth from context
	auth, ok := r.Context().Value("auth").(authData)
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	// Query database
	doc, err := s.db.Queries.GetDocument(r.Context(), id)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "Document not found")
		return
	}

	// Get progress
	progressRow, err := s.db.Queries.GetDocumentProgress(r.Context(), database.GetDocumentProgressParams{
		UserID:     auth.UserName,
		DocumentID: id,
	})
	var progress *Progress
	if err == nil {
		progress = &Progress{
			UserID:     progressRow.UserID,
			DocumentID: progressRow.DocumentID,
			DeviceID:   progressRow.DeviceID,
			Percentage: progressRow.Percentage,
			Progress:   progressRow.Progress,
			CreatedAt:  progressRow.CreatedAt,
		}
	}

	// Return response
	writeJSON(w, http.StatusOK, DocumentResponse{
		Document: doc,
		User:     UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
		Progress: progress,
	})
}