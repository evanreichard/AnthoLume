package v1

import (
	"context"

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
		User:       UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
	}
	return GetActivity200JSONResponse(response), nil
}
