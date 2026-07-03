package v1

import (
	"context"
	"crypto/md5"
	"fmt"

	"reichard.io/antholume/database"
	argon2id "github.com/alexedwards/argon2id"
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

// authorizeCredentials verifies if credentials are valid
func (s *Server) authorizeCredentials(ctx context.Context, username string, password string) bool {
	user, err := s.db.Queries.GetUser(ctx, username)
	if err != nil {
		return false
	}

	// Try argon2 hash comparison
	if match, err := argon2id.ComparePasswordAndHash(password, *user.Pass); err == nil && match {
		return true
	}

	return false
}

// PUT /settings
func (s *Server) UpdateSettings(ctx context.Context, request UpdateSettingsRequestObject) (UpdateSettingsResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return UpdateSettings401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	if request.Body == nil {
		return UpdateSettings400JSONResponse{Code: 400, Message: "Request body is required"}, nil
	}

	user, err := s.db.Queries.GetUser(ctx, auth.UserName)
	if err != nil {
		return UpdateSettings500JSONResponse{Code: 500, Message: err.Error()}, nil
	}

	updateParams := database.UpdateUserParams{
		UserID: auth.UserName,
		Admin:  auth.IsAdmin,
	}

	// Update password if provided
	if request.Body.NewPassword != nil {
		if request.Body.Password == nil {
			return UpdateSettings400JSONResponse{Code: 400, Message: "Current password is required to set new password"}, nil
		}

		// Verify current password - first try bcrypt (new format), then argon2, then MD5 (legacy format)
		currentPasswordMatched := false

		// Try argon2 (current format)
		if !currentPasswordMatched {
			currentPassword := fmt.Sprintf("%x", md5.Sum([]byte(*request.Body.Password)))
			if match, err := argon2id.ComparePasswordAndHash(currentPassword, *user.Pass); err == nil && match {
				currentPasswordMatched = true
			}
		}

		if !currentPasswordMatched {
			return UpdateSettings400JSONResponse{Code: 400, Message: "Invalid current password"}, nil
		}

		// Hash new password with argon2
		newPassword := fmt.Sprintf("%x", md5.Sum([]byte(*request.Body.NewPassword)))
		hashedPassword, err := argon2id.CreateHash(newPassword, argon2id.DefaultParams)
		if err != nil {
			return UpdateSettings500JSONResponse{Code: 500, Message: "Failed to hash password"}, nil
		}
		updateParams.Password = &hashedPassword
	}

	// Update timezone if provided
	if request.Body.Timezone != nil {
		updateParams.Timezone = request.Body.Timezone
	}

	// If nothing to update, return error
	if request.Body.NewPassword == nil && request.Body.Timezone == nil {
		return UpdateSettings400JSONResponse{Code: 400, Message: "At least one field must be provided"}, nil
	}

	// Update user
	_, err = s.db.Queries.UpdateUser(ctx, updateParams)
	if err != nil {
		return UpdateSettings500JSONResponse{Code: 500, Message: err.Error()}, nil
	}

	// Get updated settings to return
	user, err = s.db.Queries.GetUser(ctx, auth.UserName)
	if err != nil {
		return UpdateSettings500JSONResponse{Code: 500, Message: err.Error()}, nil
	}

	devices, err := s.db.Queries.GetDevices(ctx, auth.UserName)
	if err != nil {
		return UpdateSettings500JSONResponse{Code: 500, Message: err.Error()}, nil
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
	return UpdateSettings200JSONResponse(response), nil
}

