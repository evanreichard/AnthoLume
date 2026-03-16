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

	devices, err := s.db.Queries.GetDevices(ctx, auth.UserName)
	if err != nil {
		return GetSettings500JSONResponse{Code: 500, Message: err.Error()}, nil
	}

	apiDevices := make([]Device, len(devices))
	for i, device := range devices {
		apiDevices[i] = Device{
			Id:         &device.ID,
			DeviceName: &device.DeviceName,
			CreatedAt:  parseTimePtr(device.CreatedAt),
			LastSynced: parseTimePtr(device.LastSynced),
		}
	}

	response := SettingsResponse{
		User:     UserData{Username: auth.UserName, IsAdmin: auth.IsAdmin},
		Timezone: user.Timezone,
		Devices:  &apiDevices,
	}
	return GetSettings200JSONResponse(response), nil
}

