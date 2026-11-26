package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"reichard.io/antholume/database"
	"reichard.io/antholume/shelfmark"
)

func (s *webAPI) shelfmarkSettings(ctx context.Context) (ShelfmarkSettings, error) {
	if s.api.shelfmark == nil {
		return ShelfmarkSettings{}, nil
	}
	value, err := s.api.db.Queries.GetShelfmarkEnabled(ctx)
	return ShelfmarkSettings{Configured: true, Enabled: value == "true"}, err
}

func (s *webAPI) GetShelfmarkSettings(ctx context.Context, _ GetShelfmarkSettingsRequestObject) (GetShelfmarkSettingsResponseObject, error) {
	state, err := s.shelfmarkSettings(requestContext(ctx))
	return GetShelfmarkSettings200JSONResponse(state), err
}

func (s *webAPI) SetShelfmarkSettings(ctx context.Context, r SetShelfmarkSettingsRequestObject) (SetShelfmarkSettingsResponseObject, error) {
	if s.api.shelfmark == nil {
		return nil, adminFailure(http.StatusConflict, "shelfmark_unconfigured")
	}
	_, err := s.api.db.Queries.UpdateSettings(requestContext(ctx), database.UpdateSettingsParams{Name: "shelfmark_enabled", Value: strconv.FormatBool(r.Body.Enabled)})
	return SetShelfmarkSettings200JSONResponse{Configured: true, Enabled: r.Body.Enabled}, err
}

func (s *webAPI) requireShelfmark(ctx context.Context) error {
	state, err := s.shelfmarkSettings(ctx)
	if err != nil {
		return err
	}
	if !state.Configured {
		return adminFailure(http.StatusConflict, "shelfmark_unconfigured")
	}
	if !state.Enabled {
		return adminFailure(http.StatusConflict, "shelfmark_disabled")
	}
	return nil
}

func shelfmarkError(err error, notFoundCode string) error {
	if errors.Is(err, shelfmark.ErrNotFound) && notFoundCode != "" {
		return adminFailure(http.StatusNotFound, notFoundCode)
	}
	return adminFailure(http.StatusBadGateway, "shelfmark_upstream_error")
}

func shelfmarkBook(book shelfmark.Book) ShelfmarkBook {
	return ShelfmarkBook{Provider: book.Provider, Id: book.ID, Title: book.Title, Author: book.Author, Description: book.Description, Year: book.Year, HasCover: book.HasCover}
}

func shelfmarkHistoryBook(row database.ShelfmarkRequest) (ShelfmarkBook, error) {
	at, err := time.Parse(time.RFC3339Nano, row.RequestedAt)
	if err != nil {
		return ShelfmarkBook{}, err
	}
	state := Confirming
	if row.RemoteID != nil {
		state = Requested
	}
	return ShelfmarkBook{Provider: row.Provider, Id: row.BookID, Title: row.Title, Author: row.Author, Description: row.Description,
		Year: int(row.Year), HasCover: row.HasCover,
		Request: &ShelfmarkRequestInfo{Username: row.Username, RequestedAt: at.UTC(), State: state}}, nil
}

func (s *webAPI) SearchShelfmark(ctx context.Context, r SearchShelfmarkRequestObject) (SearchShelfmarkResponseObject, error) {
	ctx = requestContext(ctx)
	if err := s.requireShelfmark(ctx); err != nil {
		return nil, err
	}
	query := strings.TrimSpace(r.Params.Q)
	if query == "" {
		return nil, adminFailure(http.StatusBadRequest, "invalid_request")
	}
	books, err := s.api.shelfmark.Search(ctx, query)
	if err != nil {
		return nil, shelfmarkError(err, "")
	}
	out := make(SearchShelfmark200JSONResponse, 0, len(books))
	if len(books) == 0 {
		return out, nil
	}
	keys := make([][2]string, 0, len(books))
	for _, book := range books {
		keys = append(keys, [2]string{book.Provider, book.ID})
	}
	encoded, err := json.Marshal(keys)
	if err != nil {
		return nil, err
	}
	rows, err := s.api.db.Queries.FindShelfmarkRequests(ctx, string(encoded))
	if err != nil {
		return nil, err
	}
	requests := make(map[[2]string]*ShelfmarkRequestInfo, len(rows))
	for _, row := range rows {
		book, err := shelfmarkHistoryBook(row)
		if err != nil {
			return nil, err
		}
		requests[[2]string{book.Provider, book.Id}] = book.Request
	}
	for i, source := range books {
		book := shelfmarkBook(source)
		book.Request = requests[keys[i]]
		out = append(out, book)
	}
	return out, nil
}

func (s *webAPI) GetShelfmarkCover(ctx context.Context, r GetShelfmarkCoverRequestObject) (GetShelfmarkCoverResponseObject, error) {
	request := requestContext(ctx)
	if err := s.requireShelfmark(request); err != nil {
		return nil, err
	}
	data, media, err := s.api.shelfmark.Cover(request, r.Params.Provider, r.Params.Id)
	if err != nil {
		return nil, shelfmarkError(err, "shelfmark_cover_not_found")
	}
	setCoverResponseHeaders(ginContext(ctx).Writer)
	return GetShelfmarkCover200ImageResponse{Body: bytes.NewReader(data), ContentType: media, ContentLength: int64(len(data))}, nil
}

func (s *webAPI) ListShelfmarkRequests(ctx context.Context, r ListShelfmarkRequestsRequestObject) (ListShelfmarkRequestsResponseObject, error) {
	ctx = requestContext(ctx)
	if err := s.requireShelfmark(ctx); err != nil {
		return nil, err
	}
	var offset int64
	if r.Params.Offset != nil {
		offset = int64(*r.Params.Offset)
	}
	rows, err := s.api.db.Queries.ListShelfmarkRequests(ctx, offset)
	if err != nil {
		return nil, err
	}
	out := make(ListShelfmarkRequests200JSONResponse, 0, len(rows))
	for _, row := range rows {
		book, err := shelfmarkHistoryBook(row)
		if err != nil {
			return nil, err
		}
		out = append(out, book)
	}
	return out, nil
}

func (s *webAPI) CreateShelfmarkRequest(ctx context.Context, r CreateShelfmarkRequestRequestObject) (CreateShelfmarkRequestResponseObject, error) {
	username := webUser(ctx).UserName
	ctx = requestContext(ctx)
	if err := s.requireShelfmark(ctx); err != nil {
		return nil, err
	}
	queries := s.api.db.Queries
	key := database.GetShelfmarkRequestParams{Provider: r.Body.Provider, BookID: r.Body.Id}
	row, err := queries.GetShelfmarkRequest(ctx, key)
	if err == nil {
		return s.recheckShelfmarkRequest(ctx, row, key)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if r.Body.CheckOnly != nil && *r.Body.CheckOnly {
		return nil, adminFailure(http.StatusNotFound, "shelfmark_request_not_found")
	}
	book, err := s.api.shelfmark.Book(ctx, key.Provider, key.BookID)
	if err != nil {
		return nil, shelfmarkError(err, "shelfmark_book_not_found")
	}
	if err := s.requireShelfmark(ctx); err != nil {
		return nil, err
	}
	row, err = queries.ClaimShelfmarkRequest(ctx, database.ClaimShelfmarkRequestParams{
		Provider: book.Provider, BookID: book.ID, Title: book.Title, Author: book.Author, Description: book.Description,
		Year: int64(book.Year), HasCover: book.HasCover, Username: username, RequestedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if errors.Is(err, sql.ErrNoRows) {
		row, err = queries.GetShelfmarkRequest(ctx, key)
		if err == nil {
			return s.recheckShelfmarkRequest(ctx, row, key)
		}
		if errors.Is(err, sql.ErrNoRows) {
			return nil, adminFailure(http.StatusConflict, "shelfmark_request_changed")
		}
	}
	if err != nil {
		return nil, err
	}

	remoteID, err := s.api.shelfmark.Create(ctx, book)
	// Settle a known outcome even when the requester's connection has gone away.
	settle, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	if errors.Is(err, shelfmark.ErrRejected) {
		removed, releaseErr := queries.ReleaseShelfmarkRequest(settle, row.Sequence)
		if releaseErr != nil {
			return nil, releaseErr
		}
		if removed == 0 {
			return s.currentShelfmarkRequest(settle, key)
		}
		return nil, adminFailure(http.StatusBadGateway, "shelfmark_request_rejected")
	}
	if err == nil {
		return s.completeShelfmarkRequest(settle, row.Sequence, remoteID, key)
	}
	return s.currentShelfmarkRequest(settle, key)
}

func (s *webAPI) recheckShelfmarkRequest(ctx context.Context, row database.ShelfmarkRequest, key database.GetShelfmarkRequestParams) (CreateShelfmarkRequestResponseObject, error) {
	if row.RemoteID != nil {
		return shelfmarkRequestResponse(row)
	}
	lookup, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	if id, err := s.api.shelfmark.Find(lookup, key.Provider, key.BookID); err == nil && id > 0 {
		return s.completeShelfmarkRequest(ctx, row.Sequence, id, key)
	}
	return s.currentShelfmarkRequest(ctx, key)
}

func (s *webAPI) completeShelfmarkRequest(ctx context.Context, sequence, remoteID int64, key database.GetShelfmarkRequestParams) (CreateShelfmarkRequestResponseObject, error) {
	if _, err := s.api.db.Queries.CompleteShelfmarkRequest(ctx, database.CompleteShelfmarkRequestParams{Sequence: sequence, RemoteID: &remoteID}); err != nil {
		return nil, err
	}
	return s.currentShelfmarkRequest(ctx, key)
}

func (s *webAPI) currentShelfmarkRequest(ctx context.Context, key database.GetShelfmarkRequestParams) (CreateShelfmarkRequestResponseObject, error) {
	row, err := s.api.db.Queries.GetShelfmarkRequest(ctx, key)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, adminFailure(http.StatusConflict, "shelfmark_request_changed")
	}
	if err != nil {
		return nil, err
	}
	return shelfmarkRequestResponse(row)
}

func shelfmarkRequestResponse(row database.ShelfmarkRequest) (CreateShelfmarkRequestResponseObject, error) {
	book, err := shelfmarkHistoryBook(row)
	return CreateShelfmarkRequest200JSONResponse(book), err
}
