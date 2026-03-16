package v1

import (
	"context"
	"math"

	"reichard.io/antholume/database"
	log "github.com/sirupsen/logrus"
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
		UserID:  auth.UserName,
		Offset:  (page - 1) * limit,
		Limit:   limit,
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
			Title:       row.Title,
			Author:      row.Author,
			DeviceName:  &row.DeviceName,
			Percentage:  &row.Percentage,
			DocumentId:  &row.DocumentID,
			UserId:      &row.UserID,
			CreatedAt:   parseTimePtr(row.CreatedAt),
		}
	}

	response := ProgressListResponse{
		Progress:     &apiProgress,
		User:         &UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
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

	filter := database.GetProgressParams{
		UserID:      auth.UserName,
		DocFilter:   true,
		DocumentID:  request.Id,
		Offset:      0,
		Limit:       1,
	}

	progress, err := s.db.Queries.GetProgress(ctx, filter)
	if err != nil {
		log.Error("GetProgress DB Error:", err)
		return GetProgress404JSONResponse{Code: 404, Message: "Progress not found"}, nil
	}

	if len(progress) == 0 {
		return GetProgress404JSONResponse{Code: 404, Message: "Progress not found"}, nil
	}

	row := progress[0]
	apiProgress := Progress{
		Title:       row.Title,
		Author:      row.Author,
		DeviceName:  &row.DeviceName,
		Percentage:  &row.Percentage,
		DocumentId:  &row.DocumentID,
		UserId:      &row.UserID,
		CreatedAt:   parseTimePtr(row.CreatedAt),
	}

	response := ProgressResponse{
		Progress: &apiProgress,
		User:     &UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
	}

	return GetProgress200JSONResponse(response), nil
}