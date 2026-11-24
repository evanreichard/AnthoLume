package api

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"strings"

	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
)

func adminFailure(status int, code string) error { return &webFailure{status: status, code: code} }

func requireAdmin(ctx context.Context, q *database.Queries, principal authData) error {
	admin, err := q.GetAdminSessionRole(ctx, database.GetAdminSessionRoleParams{
		ID:       principal.UserName,
		AuthHash: &principal.AuthHash,
	})
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
	if err := requireAdmin(ctx, s.api.db.Queries.WithTx(tx), principal); err != nil {
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
	rows, err := s.api.db.Queries.ListAdminUsers(requestContext(ctx), after)
	if err != nil {
		return nil, err
	}
	out := make(ListAdminUsers200JSONResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, AdminUser{Id: row.ID, IsAdmin: row.Admin})
	}
	return out, nil
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
		n, err := s.api.db.Queries.WithTx(tx).CreateAdminUser(ctx, database.CreateAdminUserParams{
			ID:       id,
			Pass:     &hash,
			AuthHash: &token,
			Admin:    r.Body.IsAdmin,
		})
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
		admin, err := s.api.db.Queries.WithTx(tx).UpdateAdminUser(ctx, database.UpdateAdminUserParams{
			ID:       r.Id,
			Pass:     hash,
			AuthHash: token,
			Admin:    r.Body.IsAdmin,
		})
		if errors.Is(err, sql.ErrNoRows) {
			return adminFailure(404, "user_not_found")
		}
		out.IsAdmin = admin
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
	var deleted database.GetHardcoverLinkForUserDeletionRow
	err := s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		q := s.api.db.Queries.WithTx(tx)
		var err error
		deleted, err = q.GetHardcoverLinkForUserDeletion(ctx, r.Id)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return adminFailure(404, "user_not_found")
			}
			return err
		}
		if err := q.DeleteAdminUserStatistics(ctx, r.Id); err != nil {
			return err
		}
		if err := q.DeleteAdminUserStreaks(ctx, r.Id); err != nil {
			return err
		}
		if err := q.DeleteAdminUserProgress(ctx, r.Id); err != nil {
			return err
		}
		n, err := q.DeleteUser(ctx, r.Id)
		if err == nil && n == 0 {
			return adminFailure(404, "user_not_found")
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	s.api.revokeDeletedHardcoverLink(requestContext(ctx), hardcoverAccountKey(authData{AccountID: deleted.AccountID, Generation: deleted.Generation}), deleted.Credential)
	return DeleteAdminUser204Response{}, nil
}

func (api *API) revokeDeletedHardcoverLink(ctx context.Context, account string, encrypted []byte) {
	f := &api.hardcover
	f.cancel(account)
	if f.client == nil || len(encrypted) == 0 {
		return
	}
	// After Commit - Local deletion already cascaded; a canceled HTTP request must not skip remote revocation.
	call, cancel := context.WithTimeout(context.WithoutCancel(ctx), hardcoverCallTimeout)
	defer cancel()
	if err := f.client.RevokeStored(call, account, encrypted); err != nil {
		log.Warn("Hardcover revocation could not be confirmed for a deleted account")
	}
}

func (api *API) writeVerifiedSnapshot(ctx context.Context, filename string) error {
	if err := api.db.BackupSnapshot(ctx, filename); err != nil {
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
		return errors.New("database snapshot failed integrity check")
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
