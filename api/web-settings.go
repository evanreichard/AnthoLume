package api

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/gin-contrib/sessions"
	"reichard.io/antholume/reading"
)

func (s *webAPI) UpdatePreferences(ctx context.Context, r UpdatePreferencesRequestObject) (UpdatePreferencesResponseObject, error) {
	if s.api.cfg.DemoMode {
		return nil, &reading.Failure{Status: 403, Code: "forbidden"}
	}
	zone := strings.TrimSpace(r.Body.Timezone)
	if _, err := time.LoadLocation(zone); err != nil || zone == "" || zone == "Local" {
		return nil, &reading.Failure{Status: 400, Code: "invalid_timezone"}
	}
	principal := webUser(ctx)
	result, err := s.api.db.DB.ExecContext(requestContext(ctx), `UPDATE users SET timezone=? WHERE id=? AND auth_hash=?`, zone, principal.UserName, principal.AuthHash)
	if err != nil {
		return nil, err
	}
	n, err := result.RowsAffected()
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
	if api.cfg.DemoMode {
		return nil, &reading.Failure{Status: 403, Code: "forbidden"}
	}
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
	result, err := api.db.DB.ExecContext(request, `UPDATE users SET pass=?,auth_hash=? WHERE id=? AND auth_hash=?`, password, token, principal.UserName, principal.AuthHash)
	if err != nil {
		return nil, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, &reading.Failure{Status: 401, Code: "unauthenticated"}
	}
	verified.AuthHash = token
	if err = api.setSession(sessions.Default(ginContext(ctx)), *verified); err != nil {
		return nil, err
	}
	out, err := s.session(ctx)
	return ChangePassword200JSONResponse(out), err
}

const managedDevices = `SELECT d.id,d.device_name,COALESCE(p.label,''),COALESCE(p.archived,0),d.last_synced FROM devices d LEFT JOIN device_preferences p ON p.device_id=d.id WHERE d.user_id=?`

type deviceScanner interface{ Scan(...any) error }

func scanManagedDevice(row deviceScanner) (ManagedDevice, error) {
	var out ManagedDevice
	var stamp string
	if err := row.Scan(&out.Id, &out.Name, &out.Label, &out.Archived, &stamp); err != nil {
		return out, err
	}
	last, err := time.Parse(time.RFC3339, stamp)
	out.LastSynced = last.UTC()
	return out, err
}

func (s *webAPI) ListManagedDevices(ctx context.Context, _ ListManagedDevicesRequestObject) (ListManagedDevicesResponseObject, error) {
	rows, err := s.api.db.DB.QueryContext(requestContext(ctx), managedDevices+` ORDER BY d.last_synced DESC,d.id ASC LIMIT 501`, webUser(ctx).UserName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := ListManagedDevices200JSONResponse{}
	for rows.Next() {
		if len(out) >= 500 {
			return nil, &reading.Failure{Status: 409, Code: "too_many_devices"}
		}
		device, err := scanManagedDevice(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, device)
	}
	return out, rows.Err()
}

func (s *webAPI) UpdateDevicePreferences(ctx context.Context, r UpdateDevicePreferencesRequestObject) (UpdateDevicePreferencesResponseObject, error) {
	if s.api.cfg.DemoMode {
		return nil, &reading.Failure{Status: 403, Code: "forbidden"}
	}
	user := webUser(ctx).UserName
	request := requestContext(ctx)
	tx, err := s.api.db.DB.BeginTx(request, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(request, `INSERT INTO device_preferences(device_id,label,archived) SELECT id,?,? FROM devices WHERE user_id=? AND id=? ON CONFLICT(device_id) DO UPDATE SET label=excluded.label,archived=excluded.archived`, strings.TrimSpace(r.Body.Label), r.Body.Archived, user, r.Id)
	if err != nil {
		return nil, err
	}
	device, err := scanManagedDevice(tx.QueryRowContext(request, managedDevices+` AND d.id=?`, user, r.Id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return UpdateDevicePreferences200JSONResponse(device), nil
}
