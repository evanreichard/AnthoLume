package v1

import (
	"context"
)

// GET /settings
func (s *Server) GetSettings(ctx context.Context, request GetSettingsRequestObject) (GetSettingsResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetSettings401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	user, err := s.db.Queries.GetUser(ctx, auth.UserName)
	if err != nil {
		return GetSettings500JSONResponse{Code: 500, Message: err.Error()}, nil
	}

	response := SettingsResponse{
		Settings: []Setting{},
		User:     UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
		Timezone: user.Timezone,
	}
	return GetSettings200JSONResponse(response), nil
}

