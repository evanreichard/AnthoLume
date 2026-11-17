package api

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/gin-contrib/sessions"
	"reichard.io/antholume/database"
	"reichard.io/antholume/reading"
)

type webAPI struct{ api *API }

func (s *webAPI) session(ctx context.Context) (Session, error) {
	c := ginContext(ctx)
	session := sessions.Default(c)
	api := s.api
	auth, ok, err := api.sessionIdentity(c.Request.Context(), session)
	if err != nil {
		return Session{}, err
	}
	token, tok := session.Get("csrf").(string)
	anonExpiry, aok := session.Get("anonymousExpiresAt").(int64)
	if !ok && (!tok || token == "" || !aok || anonExpiry <= time.Now().Unix()) {
		if err := api.anonymousSession(session); err != nil {
			return Session{}, err
		}
		token = session.Get("csrf").(string)
	} else if ok && (!tok || token == "") {
		var err error
		token, err = randomCSRF()
		if err != nil {
			return Session{}, err
		}
		session.Set("csrf", token)
		if err = session.Save(); err != nil {
			return Session{}, err
		}
	}
	result := Session{CsrfToken: token}
	if ok {
		user, err := api.db.Queries.GetUser(c.Request.Context(), auth.UserName)
		if err != nil {
			return result, err
		}
		if user.Timezone == nil {
			return result, errInvalidSession
		}
		result.User = &struct {
			Id       ID     `json:"id"`
			IsAdmin  bool   `json:"is_admin"`
			Timezone string `json:"timezone"`
		}{user.ID, user.Admin, *user.Timezone}
		expiry := time.Unix(session.Get("expiresAt").(int64), 0).UTC()
		result.ExpiresAt = &expiry
	}
	return result, nil
}
func (s *webAPI) GetSession(ctx context.Context, _ GetSessionRequestObject) (GetSessionResponseObject, error) {
	out, err := s.session(ctx)
	return GetSession200JSONResponse(out), err
}
func (s *webAPI) GetCapabilities(_ context.Context, _ GetCapabilitiesRequestObject) (GetCapabilitiesResponseObject, error) {
	c := s.api.cfg
	return GetCapabilities200JSONResponse{RegistrationEnabled: c.RegistrationEnabled, SearchEnabled: c.SearchEnabled, DemoMode: c.DemoMode}, nil
}
func (s *webAPI) Login(ctx context.Context, r LoginRequestObject) (LoginResponseObject, error) {
	user, hash := rawCredentials(r.Body.Username, r.Body.Password)
	if user == "" || strings.TrimSpace(r.Body.Password) == "" {
		return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
	}
	auth, err := s.api.authorizeCredentials(requestContext(ctx), user, hash)
	if err != nil {
		return nil, err
	}
	if auth == nil {
		return nil, &reading.Failure{Status: 401, Code: "unauthenticated"}
	}
	if err := s.api.setSession(sessions.Default(ginContext(ctx)), *auth); err != nil {
		return nil, err
	}
	out, err := s.session(ctx)
	return Login200JSONResponse(out), err
}
func (s *webAPI) Register(ctx context.Context, r RegisterRequestObject) (RegisterResponseObject, error) {
	user, hash := rawCredentials(r.Body.Username, r.Body.Password)
	if strings.TrimSpace(r.Body.Password) == "" {
		return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
	}
	auth, err := s.api.registerIdentity(requestContext(ctx), user, hash)
	if err != nil {
		return nil, err
	}
	if err = s.api.setSession(sessions.Default(ginContext(ctx)), *auth); err != nil {
		return nil, err
	}
	out, err := s.session(ctx)
	return Register201JSONResponse(out), err
}
func (s *webAPI) Logout(ctx context.Context, _ LogoutRequestObject) (LogoutResponseObject, error) {
	if err := s.api.anonymousSession(sessions.Default(ginContext(ctx))); err != nil {
		return nil, err
	}
	out, err := s.session(ctx)
	return Logout200JSONResponse(out), err
}
func (s *webAPI) RegisterDevice(ctx context.Context, r RegisterDeviceRequestObject) (RegisterDeviceResponseObject, error) {
	err := s.api.reading.RegisterDevice(requestContext(ctx), webUser(ctx).UserName, r.Body.Id, r.Body.Name)
	return RegisterDevice200JSONResponse(*r.Body), err
}
func (s *webAPI) GetReadingState(ctx context.Context, r GetReadingStateRequestObject) (GetReadingStateResponseObject, error) {
	out, err := s.api.reading.State(requestContext(ctx), webUser(ctx).UserName, r.DocumentId)
	if err != nil {
		return nil, err
	}
	result := ReadingState{DocumentId: out.DocumentID, Revision: out.Revision, Position: out.Position, Fraction: out.Fraction, DeviceId: out.DeviceID}
	if out.UpdatedAt != nil {
		t, err := time.Parse(time.RFC3339Nano, *out.UpdatedAt)
		if err != nil {
			return nil, err
		}
		t = t.UTC()
		result.UpdatedAt = &t
	}
	return GetReadingState200JSONResponse(result), nil
}
func receipt(out reading.Decision) (Receipt, error) {
	if out.Status != 200 {
		return Receipt{}, &webFailure{status: out.Status, code: out.Code, revision: out.CurrentRevision}
	}
	return Receipt{EventId: out.EventID, Kind: ReceiptKind(out.Kind), Revision: out.Revision}, nil
}
func (s *webAPI) SubmitProgress(ctx context.Context, r SubmitProgressRequestObject) (SubmitProgressResponseObject, error) {
	b := r.Body
	out, err := s.api.reading.Progress(requestContext(ctx), webUser(ctx).UserName, reading.Progress{EventID: b.EventId, DocumentID: b.DocumentId, DeviceID: b.DeviceId, ObservedAt: b.ObservedAt, BaseRevision: b.BaseRevision, Position: b.Position, Fraction: b.Fraction})
	if err != nil {
		return nil, err
	}
	result, err := receipt(out)
	return SubmitProgress200JSONResponse(result), err
}
func (s *webAPI) SubmitActivity(ctx context.Context, r SubmitActivityRequestObject) (SubmitActivityResponseObject, error) {
	b := r.Body
	out, err := s.api.reading.Activity(requestContext(ctx), webUser(ctx).UserName, reading.Activity{EventID: b.EventId, DocumentID: b.DocumentId, DeviceID: b.DeviceId, StartTime: b.StartTime, Duration: b.Duration, StartFraction: b.StartFraction, EndFraction: b.EndFraction})
	if err != nil {
		return nil, err
	}
	result, err := receipt(out)
	return SubmitActivity200JSONResponse(result), err
}
func (s *webAPI) ListDocuments(ctx context.Context, r ListDocumentsRequestObject) (ListDocumentsResponseObject, error) {
	ctx = requestContext(ctx)
	page, size := 1, 24
	q := ""
	if r.Params.Page != nil {
		page = *r.Params.Page
	}
	if r.Params.PageSize != nil {
		size = *r.Params.PageSize
	}
	if r.Params.Q != nil {
		q = *r.Params.Q
	}
	tx, err := s.api.db.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result := DocumentPage{Items: []Document{}, Page: page, PageSize: size}
	filter := `deleted=0 AND (?='' OR instr(lower(coalesce(title,'')),lower(?))>0 OR instr(lower(coalesce(author,'')),lower(?))>0)`
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM documents WHERE "+filter, q, q, q).Scan(&result.Total); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT id FROM documents WHERE "+filter+" ORDER BY id ASC LIMIT ? OFFSET ?", q, q, q, size, (int64(page)-1)*int64(size))
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		d, err := database.New(tx).GetDocument(ctx, id)
		if err != nil {
			return nil, err
		}
		result.Items = append(result.Items, s.api.documentDTO(d))
	}
	if int64(page)*int64(size) < int64(result.Total) {
		next := page + 1
		result.NextPage = &next
	}
	return ListDocuments200JSONResponse(result), tx.Commit()
}
func (s *webAPI) GetDocument(ctx context.Context, r GetDocumentRequestObject) (GetDocumentResponseObject, error) {
	d, err := s.api.db.Queries.GetDocument(requestContext(ctx), r.Id)
	if errors.Is(err, sql.ErrNoRows) || err == nil && d.Deleted {
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	if err != nil {
		return nil, err
	}
	return GetDocument200JSONResponse(s.api.documentDTO(d)), nil
}
func (s *webAPI) DownloadDocument(ctx context.Context, r DownloadDocumentRequestObject) (DownloadDocumentResponseObject, error) {
	return s.api.documentBinary(ctx, r.Id, false)
}
func (s *webAPI) GetDocumentCover(ctx context.Context, r GetDocumentCoverRequestObject) (GetDocumentCoverResponseObject, error) {
	return s.api.documentBinary(ctx, r.Id, true)
}
