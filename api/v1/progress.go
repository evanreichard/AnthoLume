package v1

import (
	"context"
	"math"
	"time"

	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
)

// GET /progress
func (s *Server) GetProgressList(ctx context.Context, request GetProgressListRequestObject) (GetProgressListResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetProgressList401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	page := int64(1)
	if request.Params.Page != nil {
		page = *request.Params.Page
	}

	limit := int64(15)
	if request.Params.Limit != nil {
		limit = *request.Params.Limit
	}

	filter := database.GetProgressParams{
		UserID: auth.UserName,
		Offset: (page - 1) * limit,
		Limit:  limit,
	}

	if request.Params.Document != nil && *request.Params.Document != "" {
		filter.DocFilter = true
		filter.DocumentID = *request.Params.Document
	}

	progress, err := s.db.Queries.GetProgress(ctx, filter)
	if err != nil {
		log.Error("GetProgress DB Error:", err)
		return GetProgressList500JSONResponse{Code: 500, Message: "Database error"}, nil
	}

	total := int64(len(progress))
	var nextPage *int64
	var previousPage *int64

	// Calculate total pages
	totalPages := int64(math.Ceil(float64(total) / float64(limit)))
	if page < totalPages {
		nextPage = ptrOf(page + 1)
	}
	if page > 1 {
		previousPage = ptrOf(page - 1)
	}

	apiProgress := make([]Progress, len(progress))
	for i, row := range progress {
		apiProgress[i] = Progress{
			Title:      row.Title,
			Author:     row.Author,
			DeviceName: &row.DeviceName,
			Percentage: &row.Percentage,
			DocumentId: &row.DocumentID,
			UserId:     &row.UserID,
			CreatedAt:  parseTimePtr(row.CreatedAt),
		}
	}

	response := ProgressListResponse{
		Progress:     &apiProgress,
		Page:         &page,
		Limit:        &limit,
		NextPage:     nextPage,
		PreviousPage: previousPage,
		Total:        &total,
	}

	return GetProgressList200JSONResponse(response), nil
}

// GET /progress/{id}
func (s *Server) GetProgress(ctx context.Context, request GetProgressRequestObject) (GetProgressResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetProgress401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	row, err := s.db.Queries.GetDocumentProgress(ctx, database.GetDocumentProgressParams{
		UserID:     auth.UserName,
		DocumentID: request.Id,
	})
	if err != nil {
		log.Error("GetDocumentProgress DB Error:", err)
		return GetProgress404JSONResponse{Code: 404, Message: "Progress not found"}, nil
	}

	apiProgress := Progress{
		DeviceName: &row.DeviceName,
		DeviceId:   &row.DeviceID,
		Percentage: &row.Percentage,
		Progress:   &row.Progress,
		DocumentId: &row.DocumentID,
		UserId:     &row.UserID,
		CreatedAt:  parseTimePtr(row.CreatedAt),
	}

	response := ProgressResponse{
		Progress: &apiProgress,
	}

	return GetProgress200JSONResponse(response), nil
}

// PUT /progress
func (s *Server) UpdateProgress(ctx context.Context, request UpdateProgressRequestObject) (UpdateProgressResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return UpdateProgress401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	if request.Body == nil {
		return UpdateProgress400JSONResponse{Code: 400, Message: "Request body is required"}, nil
	}

	if _, err := s.db.Queries.UpsertDevice(ctx, database.UpsertDeviceParams{
		ID:         request.Body.DeviceId,
		UserID:     auth.UserName,
		DeviceName: request.Body.DeviceName,
		LastSynced: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		log.Error("UpsertDevice DB Error:", err)
		return UpdateProgress500JSONResponse{Code: 500, Message: "Database error"}, nil
	}

	if _, err := s.db.Queries.UpsertDocument(ctx, database.UpsertDocumentParams{
		ID: request.Body.DocumentId,
	}); err != nil {
		log.Error("UpsertDocument DB Error:", err)
		return UpdateProgress500JSONResponse{Code: 500, Message: "Database error"}, nil
	}

	progress, err := s.db.Queries.UpdateProgress(ctx, database.UpdateProgressParams{
		Percentage: request.Body.Percentage,
		DocumentID: request.Body.DocumentId,
		DeviceID:   request.Body.DeviceId,
		UserID:     auth.UserName,
		Progress:   request.Body.Progress,
	})
	if err != nil {
		log.Error("UpdateProgress DB Error:", err)
		return UpdateProgress400JSONResponse{Code: 400, Message: "Invalid request"}, nil
	}

	response := UpdateProgressResponse{
		DocumentId: progress.DocumentID,
		Timestamp:  parseTime(progress.CreatedAt),
	}

	return UpdateProgress200JSONResponse(response), nil
}
