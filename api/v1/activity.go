package v1

import (
	"context"
	"time"

	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
)

// GET /activity
func (s *Server) GetActivity(ctx context.Context, request GetActivityRequestObject) (GetActivityResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetActivity401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	docFilter := false
	if request.Params.DocFilter != nil {
		docFilter = *request.Params.DocFilter
	}

	documentID := ""
	if request.Params.DocumentId != nil {
		documentID = *request.Params.DocumentId
	}

	offset := int64(0)
	if request.Params.Offset != nil {
		offset = *request.Params.Offset
	}

	limit := int64(100)
	if request.Params.Limit != nil {
		limit = *request.Params.Limit
	}

	activities, err := s.db.Queries.GetActivity(ctx, database.GetActivityParams{
		UserID:     auth.UserName,
		DocFilter:  docFilter,
		DocumentID: documentID,
		Offset:     offset,
		Limit:      limit,
	})
	if err != nil {
		return GetActivity500JSONResponse{Code: 500, Message: err.Error()}, nil
	}

	apiActivities := make([]Activity, len(activities))
	for i, a := range activities {
		// Convert StartTime from interface{} to string
		startTimeStr := ""
		if a.StartTime != nil {
			if str, ok := a.StartTime.(string); ok {
				startTimeStr = str
			}
		}

		apiActivities[i] = Activity{
			DocumentId:      a.DocumentID,
			DeviceId:        a.DeviceID,
			StartTime:       startTimeStr,
			Title:           a.Title,
			Author:          a.Author,
			Duration:        a.Duration,
			StartPercentage: float32(a.StartPercentage),
			EndPercentage:   float32(a.EndPercentage),
			ReadPercentage:  float32(a.ReadPercentage),
		}
	}

	response := ActivityResponse{
		Activities: apiActivities,
	}
	return GetActivity200JSONResponse(response), nil
}

// POST /activity
func (s *Server) CreateActivity(ctx context.Context, request CreateActivityRequestObject) (CreateActivityResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return CreateActivity401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	if request.Body == nil {
		return CreateActivity400JSONResponse{Code: 400, Message: "Request body is required"}, nil
	}

	tx, err := s.db.DB.Begin()
	if err != nil {
		log.Error("Transaction Begin DB Error:", err)
		return CreateActivity500JSONResponse{Code: 500, Message: "Database error"}, nil
	}
	committed := false
	defer func() {
		if committed {
			return
		}
		if rollbackErr := tx.Rollback(); rollbackErr != nil {
			log.Debug("Transaction Rollback DB Error:", rollbackErr)
		}
	}()

	qtx := s.db.Queries.WithTx(tx)

	allDocumentsMap := make(map[string]struct{})
	for _, item := range request.Body.Activity {
		allDocumentsMap[item.DocumentId] = struct{}{}
	}

	for documentID := range allDocumentsMap {
		if _, err := qtx.UpsertDocument(ctx, database.UpsertDocumentParams{ID: documentID}); err != nil {
			log.Error("UpsertDocument DB Error:", err)
			return CreateActivity400JSONResponse{Code: 400, Message: "Invalid document"}, nil
		}
	}

	if _, err := qtx.UpsertDevice(ctx, database.UpsertDeviceParams{
		ID:         request.Body.DeviceId,
		UserID:     auth.UserName,
		DeviceName: request.Body.DeviceName,
		LastSynced: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		log.Error("UpsertDevice DB Error:", err)
		return CreateActivity400JSONResponse{Code: 400, Message: "Invalid device"}, nil
	}

	for _, item := range request.Body.Activity {
		if _, err := qtx.AddActivity(ctx, database.AddActivityParams{
			UserID:          auth.UserName,
			DocumentID:      item.DocumentId,
			DeviceID:        request.Body.DeviceId,
			StartTime:       time.Unix(item.StartTime, 0).UTC().Format(time.RFC3339),
			Duration:        item.Duration,
			StartPercentage: float64(item.Page) / float64(item.Pages),
			EndPercentage:   float64(item.Page+1) / float64(item.Pages),
		}); err != nil {
			log.Error("AddActivity DB Error:", err)
			return CreateActivity400JSONResponse{Code: 400, Message: "Invalid activity"}, nil
		}
	}

	if err := tx.Commit(); err != nil {
		log.Error("Transaction Commit DB Error:", err)
		return CreateActivity500JSONResponse{Code: 500, Message: "Database error"}, nil
	}
	committed = true

	response := CreateActivityResponse{Added: int64(len(request.Body.Activity))}
	return CreateActivity200JSONResponse(response), nil
}
