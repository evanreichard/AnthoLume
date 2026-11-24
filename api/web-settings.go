package api

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/gin-contrib/sessions"
	"reichard.io/antholume/database"
	"reichard.io/antholume/reading"
)

func (s *webAPI) UpdatePreferences(ctx context.Context, r UpdatePreferencesRequestObject) (UpdatePreferencesResponseObject, error) {
	zone := strings.TrimSpace(r.Body.Timezone)
	if _, err := time.LoadLocation(zone); err != nil || zone == "" || zone == "Local" {
		return nil, &reading.Failure{Status: 400, Code: "invalid_timezone"}
	}
	principal := webUser(ctx)
	n, err := s.api.db.Queries.UpdateSessionTimezone(requestContext(ctx), database.UpdateSessionTimezoneParams{
		Timezone: &zone, UserID: principal.UserName, AuthHash: &principal.AuthHash,
	})
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, &reading.Failure{Status: 401, Code: "unauthenticated"}
	}
	out, err := s.session(ctx)
	return UpdatePreferences200JSONResponse(out), err
}

func (s *webAPI) ChangePassword(ctx context.Context, r ChangePasswordRequestObject) (ChangePasswordResponseObject, error) {
	api := s.api
	if !api.attempts.allow(ginContext(ctx).ClientIP()) {
		return nil, &reading.Failure{Status: 429, Code: "rate_limited"}
	}
	request := requestContext(ctx)
	principal := webUser(ctx)
	current, newPassword := strings.TrimSpace(r.Body.CurrentPassword), strings.TrimSpace(r.Body.NewPassword)
	if current == "" || newPassword == "" || current == newPassword {
		return nil, &reading.Failure{Status: 400, Code: "invalid_password"}
	}
	verified, err := api.authorizeCredentials(request, principal.UserName, md5Password(current))
	if err != nil {
		return nil, err
	}
	if verified == nil || verified.AuthHash != principal.AuthHash {
		return nil, &reading.Failure{Status: 403, Code: "incorrect_password"}
	}
	password, err := api.hashPassword(request, md5Password(newPassword))
	if err != nil {
		return nil, err
	}
	token, err := randomCSRF()
	if err != nil {
		return nil, err
	}
	n, err := api.db.Queries.UpdateSessionPassword(request, database.UpdateSessionPasswordParams{
		Pass: &password, NewAuthHash: &token, UserID: principal.UserName, CurrentAuthHash: &principal.AuthHash,
	})
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, &reading.Failure{Status: 401, Code: "unauthenticated"}
	}
	verified.AuthHash = token
	if err = api.setSession(request, sessions.Default(ginContext(ctx)), *verified); err != nil {
		return nil, err
	}
	out, err := s.session(ctx)
	return ChangePassword200JSONResponse(out), err
}

func managedDevice(row database.GetManagedReadingDeviceRow) (ManagedDevice, error) {
	last, err := time.Parse(time.RFC3339, row.LastSynced)
	return ManagedDevice{
		Id: row.ID, Name: row.DeviceName, Label: row.Label, Archived: row.Archived, LastSynced: last.UTC(),
	}, err
}

func (s *webAPI) ListManagedDevices(ctx context.Context, _ ListManagedDevicesRequestObject) (ListManagedDevicesResponseObject, error) {
	rows, err := s.api.db.Queries.ListManagedReadingDevices(requestContext(ctx), webUser(ctx).UserName)
	if err != nil {
		return nil, err
	}
	out := make(ListManagedDevices200JSONResponse, 0, len(rows))
	for _, row := range rows {
		if len(out) >= 500 {
			return nil, &reading.Failure{Status: 409, Code: "too_many_devices"}
		}
		device, err := managedDevice(database.GetManagedReadingDeviceRow(row))
		if err != nil {
			return nil, err
		}
		out = append(out, device)
	}
	return out, nil
}

func (s *webAPI) UpdateDevicePreferences(ctx context.Context, r UpdateDevicePreferencesRequestObject) (UpdateDevicePreferencesResponseObject, error) {
	user := webUser(ctx).UserName
	request := requestContext(ctx)
	tx, err := s.api.db.DB.BeginTx(request, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	q := s.api.db.Queries.WithTx(tx)
	if err = q.UpsertReadingDevicePreferences(request, database.UpsertReadingDevicePreferencesParams{
		Label: strings.TrimSpace(r.Body.Label), Archived: r.Body.Archived, UserID: user, DeviceID: r.Id,
	}); err != nil {
		return nil, err
	}
	row, err := q.GetManagedReadingDevice(request, database.GetManagedReadingDeviceParams{UserID: user, ID: r.Id})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	if err != nil {
		return nil, err
	}
	device, err := managedDevice(row)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return UpdateDevicePreferences200JSONResponse(device), nil
}
