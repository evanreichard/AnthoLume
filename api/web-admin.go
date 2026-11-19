package api

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func adminFailure(status int, code string) error { return &webFailure{status: status, code: code} }

func requireAdmin(ctx context.Context, tx *sql.Tx, principal authData) error {
	var admin bool
	err := tx.QueryRowContext(ctx, `SELECT admin FROM users WHERE id=? AND auth_hash=?`, principal.UserName, principal.AuthHash).Scan(&admin)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !admin) {
		return adminFailure(403, "forbidden")
	}
	return err
}

func (s *webAPI) adminTransaction(ctx context.Context, action func(context.Context, *sql.Tx) error) error {
	principal := webUser(ctx)
	if !principal.IsAdmin || s.api.cfg.DemoMode {
		return adminFailure(403, "forbidden")
	}
	ctx = requestContext(ctx)
	tx, err := s.api.db.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := requireAdmin(ctx, tx, principal); err != nil {
		return err
	}
	if err := action(ctx, tx); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *webAPI) ListAdminUsers(ctx context.Context, r ListAdminUsersRequestObject) (ListAdminUsersResponseObject, error) {
	if !webUser(ctx).IsAdmin {
		return nil, adminFailure(403, "forbidden")
	}
	after := ""
	if r.Params.After != nil {
		after = *r.Params.After
	}
	rows, err := s.api.db.DB.QueryContext(requestContext(ctx), `SELECT id,admin FROM users WHERE id>? ORDER BY id LIMIT 51`, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(ListAdminUsers200JSONResponse, 0)
	for rows.Next() {
		var user AdminUser
		if err = rows.Scan(&user.Id, &user.IsAdmin); err != nil {
			return nil, err
		}
		out = append(out, user)
	}
	return out, rows.Err()
}

func (s *webAPI) adminPassword(ctx context.Context, raw string) (string, string, error) {
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return "", "", adminFailure(403, "forbidden")
	}
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 256 {
		return "", "", adminFailure(400, "invalid_password")
	}
	if !s.api.attempts.allow(ginContext(ctx).ClientIP()) {
		return "", "", adminFailure(429, "rate_limited")
	}
	hashed, err := s.api.hashPassword(requestContext(ctx), md5Password(raw))
	if err != nil {
		return "", "", err
	}
	token, err := randomCSRF()
	return hashed, token, err
}

func (s *webAPI) CreateAdminUser(ctx context.Context, r CreateAdminUserRequestObject) (CreateAdminUserResponseObject, error) {
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	id := strings.TrimSpace(r.Body.Username)
	if id == "" || strings.ContainsAny(id, "/\\\x00\r\n\t") || id == "." || id == ".." {
		return nil, adminFailure(400, "invalid_request")
	}
	hash, token, err := s.adminPassword(ctx, r.Body.Password)
	if err != nil {
		return nil, err
	}
	err = s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `INSERT INTO users(id,pass,auth_hash,admin) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING`, id, hash, token, r.Body.IsAdmin)
		if err != nil {
			return err
		}
		n, err := res.RowsAffected()
		if err == nil && n == 0 {
			return adminFailure(409, "user_conflict")
		}
		return err
	})
	return CreateAdminUser201JSONResponse{Id: id, IsAdmin: r.Body.IsAdmin}, err
}

func (s *webAPI) UpdateAdminUser(ctx context.Context, r UpdateAdminUserRequestObject) (UpdateAdminUserResponseObject, error) {
	principal := webUser(ctx)
	if !principal.IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	if r.Id == principal.UserName {
		return nil, adminFailure(409, "current_admin")
	}
	if r.Body.Password == nil && r.Body.IsAdmin == nil {
		return nil, adminFailure(400, "invalid_request")
	}
	var hash, token *string
	if r.Body.Password != nil {
		h, k, err := s.adminPassword(ctx, *r.Body.Password)
		if err != nil {
			return nil, err
		}
		hash, token = &h, &k
	}
	out := UpdateAdminUser200JSONResponse{Id: r.Id}
	err := s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx, `UPDATE users SET pass=coalesce(?,pass), auth_hash=coalesce(?,auth_hash), admin=coalesce(?,admin) WHERE id=? RETURNING admin`, hash, token, r.Body.IsAdmin, r.Id).Scan(&out.IsAdmin)
		if errors.Is(err, sql.ErrNoRows) {
			return adminFailure(404, "user_not_found")
		}
		return err
	})
	return out, err
}

func (s *webAPI) DeleteAdminUser(ctx context.Context, r DeleteAdminUserRequestObject) (DeleteAdminUserResponseObject, error) {
	principal := webUser(ctx)
	if !principal.IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	if r.Id == principal.UserName {
		return nil, adminFailure(409, "current_admin")
	}
	if _, err := s.api.db.Queries.GetUser(requestContext(ctx), r.Id); errors.Is(err, sql.ErrNoRows) {
		return nil, adminFailure(404, "user_not_found")
	} else if err != nil {
		return nil, err
	}
	if err := s.api.adminUserSnapshot(requestContext(ctx)); err != nil {
		return nil, err
	}
	err := s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		for _, query := range []string{`DELETE FROM document_user_statistics WHERE user_id=?`, `DELETE FROM user_streaks WHERE user_id=?`, `DELETE FROM document_progress WHERE user_id=?`, `DELETE FROM users WHERE id=?`} {
			result, err := tx.ExecContext(ctx, query, r.Id)
			if err != nil {
				return err
			}
			if query == `DELETE FROM users WHERE id=?` {
				n, err := result.RowsAffected()
				if err != nil {
					return err
				}
				if n == 0 {
					return adminFailure(404, "user_not_found")
				}
			}
		}
		return nil
	})
	return DeleteAdminUser204Response{}, err
}

func (api *API) adminUserSnapshot(ctx context.Context) error {
	return api.adminRecoverySnapshot(ctx, "before-user-delete-")
}

func (api *API) adminRecoverySnapshot(ctx context.Context, prefix string) error {
	root := filepath.Join(api.cfg.ConfigPath, "backups")
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	dir, err := os.MkdirTemp(root, prefix)
	if err != nil {
		return err
	}
	verified := false
	defer func() {
		if !verified {
			_ = os.RemoveAll(dir)
		}
	}()
	if err := api.writeVerifiedSnapshot(ctx, filepath.Join(dir, "antholume.db")); err != nil {
		return err
	}
	for _, path := range []string{dir, root, filepath.Dir(root)} {
		if err := syncAdminDirectory(path); err != nil {
			return err
		}
	}
	verified = true
	return nil
}

func (api *API) writeVerifiedSnapshot(ctx context.Context, filename string) error {
	if _, err := api.db.DB.ExecContext(ctx, `VACUUM INTO ?`, filename); err != nil {
		return err
	}
	uri := (&url.URL{Scheme: "file", Path: filename, RawQuery: "mode=ro"}).String()
	check, err := sql.Open("sqlite", uri)
	if err != nil {
		return err
	}
	defer check.Close()
	var integrity string
	if err := check.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&integrity); err != nil {
		return err
	}
	if integrity != "ok" {
		return errors.New("database recovery snapshot failed integrity check")
	}
	file, err := os.Open(filename)
	if err != nil {
		return err
	}
	err = file.Sync()
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return nil
}

func syncAdminDirectory(path string) error {
	folder, err := os.Open(path)
	if err != nil {
		return err
	}
	defer folder.Close()
	return folder.Sync()
}

func (s *webAPI) GetAdminSystem(ctx context.Context, _ GetAdminSystemRequestObject) (GetAdminSystemResponseObject, error) {
	if !webUser(ctx).IsAdmin {
		return nil, adminFailure(403, "forbidden")
	}
	return GetAdminSystem200JSONResponse{Version: s.api.cfg.Version}, nil
}
