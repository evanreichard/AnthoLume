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
	user := webUser(ctx).UserName
	args := []any{q, q, q}
	if r.Params.Resumable != nil && *r.Params.Resumable {
		filter += ` AND NULLIF(filepath,'') IS NOT NULL AND EXISTS (SELECT 1 FROM reading_heads h WHERE h.user_id=? AND h.document_id=documents.id AND NULLIF(h.position,'') IS NOT NULL)`
		args = append(args, user)
	}
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM documents WHERE "+filter, args...).Scan(&result.Total); err != nil {
		return nil, err
	}
	const titleOrder = `NULLIF(trim(title),'') COLLATE NOCASE ASC NULLS LAST, id ASC`
	order := "id ASC"
	if r.Params.Sort != nil {
		switch *r.Params.Sort {
		case Title:
			order = titleOrder
		case Author:
			order = `NULLIF(trim(author),'') COLLATE NOCASE ASC NULLS LAST, ` + titleOrder
		case Added:
			order = `added_at DESC NULLS LAST, ` + titleOrder
		case Read:
			order = `last_read_at DESC NULLS LAST, ` + titleOrder
		default:
			return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
		}
	}
	const metadata = `SELECT id, strftime('%Y-%m-%dT%H:%M:%fZ', created_at) AS added_at,
		strftime('%Y-%m-%dT%H:%M:%fZ', NULLIF(MAX(
			COALESCE((SELECT MAX(julianday(a.start_time)) FROM activity a WHERE a.user_id=? AND a.document_id=documents.id AND a.duration>0 AND julianday(a.start_time)<=julianday('now')), 0),
			COALESCE((SELECT julianday(h.updated_at) FROM reading_heads h WHERE h.user_id=? AND h.document_id=documents.id AND h.position IS NOT NULL), 0)
		), 0)) AS last_read_at,
		(SELECT h.fraction FROM reading_heads h WHERE h.user_id=? AND h.document_id=documents.id AND NULLIF(h.position,'') IS NOT NULL AND h.fraction BETWEEN 0 AND 1)
		FROM documents WHERE `
	queryArgs := append([]any{user, user, user}, args...)
	rows, err := tx.QueryContext(ctx, metadata+filter+" ORDER BY "+order+" LIMIT ? OFFSET ?", append(queryArgs, size, (int64(page)-1)*int64(size))...)
	if err != nil {
		return nil, err
	}
	type sortRow struct {
		id          string
		added, read *string
		fraction    *float64
	}
	var selected []sortRow
	for rows.Next() {
		var row sortRow
		if err = rows.Scan(&row.id, &row.added, &row.read, &row.fraction); err != nil {
			rows.Close()
			return nil, err
		}
		selected = append(selected, row)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, row := range selected {
		d, err := database.New(tx).GetDocument(ctx, row.id)
		if err != nil {
			return nil, err
		}
		item := s.api.documentDTO(d)
		item.AddedAt, item.LastReadAt, item.ResumeFraction = row.added, row.read, row.fraction
		result.Items = append(result.Items, item)
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
	stats := BookReadingStats{WordCount: d.Words}
	err = s.api.db.DB.QueryRowContext(requestContext(ctx), `
		SELECT total_time_seconds, CAST(total_wpm AS INTEGER)
		FROM document_user_statistics WHERE document_id = ? AND user_id = ?`,
		r.Id, webUser(ctx).UserName).Scan(&stats.ReadingSeconds, &stats.WordsPerMinute)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	stats.ReadingSeconds = max(0, stats.ReadingSeconds)
	stats.WordsPerMinute = max(0, stats.WordsPerMinute)
	if stats.WordCount != nil && *stats.WordCount < 0 {
		stats.WordCount = nil
	}
	result := s.api.documentDTO(d)
	result.ReadingStats = &stats
	return GetDocument200JSONResponse(result), nil
}
func (s *webAPI) DownloadDocument(ctx context.Context, r DownloadDocumentRequestObject) (DownloadDocumentResponseObject, error) {
	return s.api.documentBinary(ctx, r.Id, false)
}
func (s *webAPI) GetDocumentCover(ctx context.Context, r GetDocumentCoverRequestObject) (GetDocumentCoverResponseObject, error) {
	return s.api.documentBinary(ctx, r.Id, true)
}
