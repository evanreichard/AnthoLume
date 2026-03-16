package v1

import (
	"context"
	"strconv"
	"time"

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
		apiActivities[i] = Activity{
			ActivityType: a.DeviceID,
			DocumentId:   a.DocumentID,
			Id:           strconv.Itoa(i),
			Timestamp:    time.Now(),
			UserId:       auth.UserName,
		}
	}

	response := ActivityResponse{
		Activities: apiActivities,
		User:       UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
	}
	return GetActivity200JSONResponse(response), nil
}
