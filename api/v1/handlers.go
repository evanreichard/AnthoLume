package v1

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"reichard.io/antholume/database"
)

// DocumentRequest represents a request for a single document
type DocumentRequest struct {
	ID string
}

// DocumentListRequest represents a request for listing documents
type DocumentListRequest struct {
	Page   int64
	Limit  int64
	Search *string
}

// ProgressRequest represents a request for document progress
type ProgressRequest struct {
	ID string
}

// ActivityRequest represents a request for activity data
type ActivityRequest struct {
	DocFilter  bool
	DocumentID string
	Offset     int64
	Limit      int64
}

// SettingsRequest represents a request for settings data
type SettingsRequest struct{}

// GetDocument handles GET /api/v1/documents/:id
func (s *Server) GetDocument(ctx context.Context, req DocumentRequest) (DocumentResponse, error) {
	auth := getAuthFromContext(ctx)
	if auth == nil {
		return DocumentResponse{}, &apiError{status: http.StatusUnauthorized, message: "Unauthorized"}
	}

	doc, err := s.db.Queries.GetDocument(ctx, req.ID)
	if err != nil {
		return DocumentResponse{}, &apiError{status: http.StatusNotFound, message: "Document not found"}
	}

	progressRow, err := s.db.Queries.GetDocumentProgress(ctx, database.GetDocumentProgressParams{
		UserID:     auth.UserName,
		DocumentID: req.ID,
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

	return DocumentResponse{
		Document: doc,
		User:     UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
		Progress: progress,
	}, nil
}

// GetDocuments handles GET /api/v1/documents
func (s *Server) GetDocuments(ctx context.Context, req DocumentListRequest) (DocumentsResponse, error) {
	auth := getAuthFromContext(ctx)
	if auth == nil {
		return DocumentsResponse{}, &apiError{status: http.StatusUnauthorized, message: "Unauthorized"}
	}

	rows, err := s.db.Queries.GetDocumentsWithStats(
		ctx,
		database.GetDocumentsWithStatsParams{
			UserID:  auth.UserName,
			Query:   req.Search,
			Deleted: ptrOf(false),
			Offset:  (req.Page - 1) * req.Limit,
			Limit:   req.Limit,
		},
	)
	if err != nil {
		return DocumentsResponse{}, &apiError{status: http.StatusInternalServerError, message: err.Error()}
	}

	total := int64(len(rows))
	var nextPage *int64
	var previousPage *int64
	if req.Page*req.Limit < total {
		nextPage = ptrOf(req.Page + 1)
	}
	if req.Page > 1 {
		previousPage = ptrOf(req.Page - 1)
	}

	wordCounts := make([]WordCount, 0, len(rows))
	for _, row := range rows {
		if row.Words != nil {
			wordCounts = append(wordCounts, WordCount{
				DocumentID: row.ID,
				Count:      *row.Words,
			})
		}
	}

	return DocumentsResponse{
		Documents:    rows,
		Total:        total,
		Page:         req.Page,
		Limit:        req.Limit,
		NextPage:     nextPage,
		PreviousPage: previousPage,
		Search:       req.Search,
		User:         UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
		WordCounts:   wordCounts,
	}, nil
}

// GetProgress handles GET /api/v1/progress/:id
func (s *Server) GetProgress(ctx context.Context, req ProgressRequest) (Progress, error) {
	auth := getAuthFromContext(ctx)
	if auth == nil {
		return Progress{}, &apiError{status: http.StatusUnauthorized, message: "Unauthorized"}
	}

	if req.ID == "" {
		return Progress{}, &apiError{status: http.StatusBadRequest, message: "Document ID required"}
	}

	progressRow, err := s.db.Queries.GetDocumentProgress(ctx, database.GetDocumentProgressParams{
		UserID:     auth.UserName,
		DocumentID: req.ID,
	})
	if err != nil {
		return Progress{}, &apiError{status: http.StatusNotFound, message: "Progress not found"}
	}

	return Progress{
		UserID:     progressRow.UserID,
		DocumentID: progressRow.DocumentID,
		DeviceID:   progressRow.DeviceID,
		Percentage: progressRow.Percentage,
		Progress:   progressRow.Progress,
		CreatedAt:  progressRow.CreatedAt,
	}, nil
}

// GetActivity handles GET /api/v1/activity
func (s *Server) GetActivity(ctx context.Context, req ActivityRequest) (ActivityResponse, error) {
	auth := getAuthFromContext(ctx)
	if auth == nil {
		return ActivityResponse{}, &apiError{status: http.StatusUnauthorized, message: "Unauthorized"}
	}

	activities, err := s.db.Queries.GetActivity(ctx, database.GetActivityParams{
		UserID:     auth.UserName,
		DocFilter:  req.DocFilter,
		DocumentID: req.DocumentID,
		Offset:     req.Offset,
		Limit:      req.Limit,
	})
	if err != nil {
		return ActivityResponse{}, &apiError{status: http.StatusInternalServerError, message: err.Error()}
	}

	return ActivityResponse{
		Activities: activities,
		User:       UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
	}, nil
}

// GetSettings handles GET /api/v1/settings
func (s *Server) GetSettings(ctx context.Context, req SettingsRequest) (SettingsResponse, error) {
	auth := getAuthFromContext(ctx)
	if auth == nil {
		return SettingsResponse{}, &apiError{status: http.StatusUnauthorized, message: "Unauthorized"}
	}

	user, err := s.db.Queries.GetUser(ctx, auth.UserName)
	if err != nil {
		return SettingsResponse{}, &apiError{status: http.StatusInternalServerError, message: err.Error()}
	}

	return SettingsResponse{
		Settings: []database.Setting{},
		User:     UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
		Timezone: user.Timezone,
	}, nil
}

// getAuthFromContext extracts authData from context
func getAuthFromContext(ctx context.Context) *authData {
	auth, ok := ctx.Value("auth").(authData)
	if !ok {
		return nil
	}
	return &auth
}

// apiError represents an API error with status code
type apiError struct {
	status  int
	message string
}

// Error implements error interface
func (e *apiError) Error() string {
	return e.message
}

// handlerFunc is a generic API handler function
type handlerFunc[T, R any] func(context.Context, T) (R, error)

// requestParser parses an HTTP request into a request struct
type requestParser[T any] func(*http.Request) T

// handle wraps an API handler function with HTTP response writing
func handle[T, R any](fn handlerFunc[T, R], parser requestParser[T]) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		req := parser(r)
		resp, err := fn(r.Context(), req)
		if err != nil {
			if apiErr, ok := err.(*apiError); ok {
				writeJSONError(w, apiErr.status, apiErr.message)
			} else {
				writeJSONError(w, http.StatusInternalServerError, err.Error())
			}
			return
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

// parseDocumentRequest extracts document request from HTTP request
func parseDocumentRequest(r *http.Request) DocumentRequest {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/documents/")
	id := strings.TrimPrefix(path, "/")
	return DocumentRequest{ID: id}
}

// parseDocumentListRequest extracts document list request from URL query
func parseDocumentListRequest(r *http.Request) DocumentListRequest {
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
	var searchPtr *string
	if search != "" {
		searchPtr = ptrOf("%" + search + "%")
	}
	return DocumentListRequest{
		Page:   page,
		Limit:  limit,
		Search: searchPtr,
	}
}

// parseProgressRequest extracts progress request from HTTP request
func parseProgressRequest(r *http.Request) ProgressRequest {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/progress/")
	id := strings.TrimPrefix(path, "/")
	return ProgressRequest{ID: id}
}

// parseActivityRequest extracts activity request from HTTP request
func parseActivityRequest(r *http.Request) ActivityRequest {
	return ActivityRequest{
		DocFilter:  false,
		DocumentID: "",
		Offset:     0,
		Limit:      100,
	}
}

// parseSettingsRequest extracts settings request from HTTP request
func parseSettingsRequest(r *http.Request) SettingsRequest {
	return SettingsRequest{}
}