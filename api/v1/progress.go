package v1

import (
	"context"

	"reichard.io/antholume/database"
)

// GET /progress/{id}
func (s *Server) GetProgress(ctx context.Context, request GetProgressRequestObject) (GetProgressResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetProgress401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	if request.Id == "" {
		return GetProgress404JSONResponse{Code: 404, Message: "Document ID required"}, nil
	}

	progressRow, err := s.db.Queries.GetDocumentProgress(ctx, database.GetDocumentProgressParams{
		UserID:     auth.UserName,
		DocumentID: request.Id,
	})
	if err != nil {
		return GetProgress404JSONResponse{Code: 404, Message: "Progress not found"}, nil
	}

	response := Progress{
		UserId:     progressRow.UserID,
		DocumentId: progressRow.DocumentID,
		DeviceId:   progressRow.DeviceID,
		Percentage: progressRow.Percentage,
		Progress:   progressRow.Progress,
		CreatedAt:  parseTime(progressRow.CreatedAt),
	}
	return GetProgress200JSONResponse(response), nil
}

