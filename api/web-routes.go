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
		if auth.Timezone == nil {
			return result, errInvalidSession
		}
		result.User = &SessionUser{Id: auth.UserName, AccountId: auth.AccountID, ReadingGeneration: auth.Generation, IsAdmin: auth.IsAdmin, Timezone: *auth.Timezone}
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
	return GetCapabilities200JSONResponse{RegistrationEnabled: c.RegistrationEnabled}, nil
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
	if err := s.api.setSession(requestContext(ctx), sessions.Default(ginContext(ctx)), *auth); err != nil {
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
	if err = s.api.setSession(requestContext(ctx), sessions.Default(ginContext(ctx)), *auth); err != nil {
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
	if result.DeviceId != nil && *result.DeviceId == "" {
		result.DeviceId = nil
	}
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
func checkReadingGeneration(ctx context.Context) error {
	ids := ginContext(ctx).Request.Header.Values("X-AnthoLume-Reading-Generation")
	if len(ids) != 1 || ids[0] != webUser(ctx).Generation {
		return &reading.Failure{Status: 409, Code: "stale_reading_generation"}
	}
	return nil
}

func (s *webAPI) SubmitProgress(ctx context.Context, r SubmitProgressRequestObject) (SubmitProgressResponseObject, error) {
	if err := checkReadingGeneration(ctx); err != nil {
		return nil, err
	}
	b := r.Body
	out, err := s.api.reading.Progress(requestContext(ctx), webUser(ctx).UserName, reading.Progress{EventID: b.EventId, DocumentID: b.DocumentId, DeviceID: b.DeviceId, ObservedAt: b.ObservedAt, BaseRevision: b.BaseRevision, Position: b.Position, Fraction: b.Fraction})
	if err != nil {
		return nil, err
	}
	result, err := receipt(out)
	return SubmitProgress200JSONResponse(result), err
}
func (s *webAPI) SubmitActivity(ctx context.Context, r SubmitActivityRequestObject) (SubmitActivityResponseObject, error) {
	if err := checkReadingGeneration(ctx); err != nil {
		return nil, err
	}
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
	queries := database.New(tx)
	user := webUser(ctx).UserName
	resumable := r.Params.Resumable != nil && *r.Params.Resumable
	total, err := queries.CountWebDocuments(ctx, database.CountWebDocumentsParams{
		Search: q, Resumable: resumable, UserID: user,
	})
	if err != nil {
		return nil, err
	}
	result.Total = int(total)
	sortBy := ""
	if r.Params.Sort != nil {
		switch *r.Params.Sort {
		case Title, Author, Added, Read:
			sortBy = string(*r.Params.Sort)
		default:
			return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
		}
	}
	selected, err := queries.ListWebDocuments(ctx, database.ListWebDocumentsParams{
		Search: q, Resumable: resumable, UserID: user, SortBy: sortBy,
		PageSize: int64(size), PageOffset: (int64(page) - 1) * int64(size),
	})
	if err != nil {
		return nil, err
	}
	includeMatches := r.Params.Include != nil && *r.Params.Include == Matches
	var matches map[string][]DocumentMatch
	if includeMatches && len(selected) != 0 {
		ids := make([]string, 0, len(selected))
		for _, row := range selected {
			ids = append(ids, row.Document.ID)
		}
		matches, err = listedDocumentMatches(ctx, queries, ids)
		if err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	for _, row := range selected {
		root := AdminStorageRoot{Id: libraryRoot}
		if row.Document.StorageRootID != nil {
			root.Id = *row.Document.StorageRootID
		}
		if row.RootPath != nil {
			root.Path = *row.RootPath
		}
		item := s.api.documentDTOAtRoot(row.Document, s.api.effectiveRoot(root).Path)
		// The query returns an empty string for a missing formatted timestamp.
		if row.AddedAt != "" {
			item.AddedAt = &row.AddedAt
		}
		if row.LastReadAt != "" {
			item.LastReadAt = &row.LastReadAt
		}
		item.ResumeFraction = row.ResumeFraction
		if includeMatches {
			links := matches[row.Document.ID]
			if links == nil {
				links = []DocumentMatch{}
			}
			item.Matches = &links
		}
		result.Items = append(result.Items, item)
	}
	if int64(page)*int64(size) < total {
		next := page + 1
		result.NextPage = &next
	}
	return ListDocuments200JSONResponse(result), nil
}
func (s *webAPI) GetDocument(ctx context.Context, r GetDocumentRequestObject) (GetDocumentResponseObject, error) {
	d, err := s.api.db.Queries.GetDocument(requestContext(ctx), r.Id)
	if errors.Is(err, sql.ErrNoRows) || err == nil && d.Deleted {
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	if err != nil {
		return nil, err
	}
	row, err := s.api.db.Queries.GetWebDocumentReadingStats(requestContext(ctx), database.GetWebDocumentReadingStatsParams{
		DocumentID: r.Id, UserID: webUser(ctx).UserName,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	stats := BookReadingStats{
		WordCount: d.Words, ReadingSeconds: max(0, row.TotalTimeSeconds), WordsPerMinute: max(0, row.WordsPerMinute),
	}
	if stats.WordCount != nil && *stats.WordCount < 0 {
		stats.WordCount = nil
	}
	matches, err := documentMatches(requestContext(ctx), s.api.db.Queries, r.Id)
	if err != nil {
		return nil, err
	}
	result := s.api.documentDTO(d)
	result.Matches = matches
	result.ReadingStats = &stats
	if webUser(ctx).IsAdmin && d.Filepath != nil {
		rootID := libraryRoot
		if d.StorageRootID != nil {
			rootID = *d.StorageRootID
		}
		result.StorageRootId = &rootID
		result.RelativeFilePath = d.Filepath
	}
	return GetDocument200JSONResponse(result), nil
}
func (s *webAPI) DownloadDocument(ctx context.Context, r DownloadDocumentRequestObject) (DownloadDocumentResponseObject, error) {
	return s.api.documentBinary(ctx, r.Id, false)
}
func (s *webAPI) GetDocumentCover(ctx context.Context, r GetDocumentCoverRequestObject) (GetDocumentCoverResponseObject, error) {
	return s.api.documentBinary(ctx, r.Id, true)
}
