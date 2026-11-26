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

func shelfmarkRelease(release shelfmark.Release) ShelfmarkRelease {
	var author *string
	if release.Author != "" {
		author = new(release.Author)
	}
	return ShelfmarkRelease{Key: release.Key, Source: release.Source, Title: release.Title, Author: author, Format: release.Format,
		Size: release.Size, Language: release.Language, Indexer: release.Indexer}
}

func shelfmarkRequestedRelease(row database.ShelfmarkRelease) (ShelfmarkRelease, error) {
	at, err := time.Parse(time.RFC3339Nano, row.RequestedAt)
	if err != nil {
		return ShelfmarkRelease{}, err
	}
	release := shelfmarkRelease(shelfmark.Release{Key: row.ReleaseKey, Source: row.Source, Title: row.ReleaseTitle,
		Author: row.ReleaseAuthor, Format: row.Format, Size: row.Size, Language: row.Language, Indexer: row.Indexer})
	release.Request = &ShelfmarkRequestInfo{Username: row.Username, RequestedAt: at.UTC(), State: ShelfmarkRequestInfoState(row.State)}
	return release, nil
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
	rows, err := s.api.db.Queries.CountShelfmarkBookReleases(ctx, string(encoded))
	if err != nil {
		return nil, err
	}
	counts := make(map[[2]string]int, len(rows))
	for _, row := range rows {
		counts[[2]string{row.Provider, row.BookID}] = int(row.RequestCount)
	}
	for i, source := range books {
		book := shelfmarkBook(source)
		book.RequestCount = counts[keys[i]]
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
		out = append(out, ShelfmarkBook{Provider: row.Provider, Id: row.BookID, Title: row.BookTitle, Author: row.Author,
			Description: row.Description, Year: int(row.Year), HasCover: row.HasCover, RequestCount: int(row.RequestCount)})
	}
	return out, nil
}

func (s *webAPI) ListShelfmarkRequestedReleases(ctx context.Context, r ListShelfmarkRequestedReleasesRequestObject) (ListShelfmarkRequestedReleasesResponseObject, error) {
	ctx = requestContext(ctx)
	if err := s.requireShelfmark(ctx); err != nil {
		return nil, err
	}
	rows, err := s.api.db.Queries.ListShelfmarkRequestedReleases(ctx, database.ListShelfmarkRequestedReleasesParams{Provider: r.Params.Provider, BookID: r.Params.Id})
	if err != nil {
		return nil, err
	}
	out := make(ListShelfmarkRequestedReleases200JSONResponse, 0, len(rows))
	for _, row := range rows {
		release, err := shelfmarkRequestedRelease(row)
		if err != nil {
			return nil, err
		}
		out = append(out, release)
	}
	return out, nil
}

func (s *webAPI) ListShelfmarkReleases(ctx context.Context, r ListShelfmarkReleasesRequestObject) (ListShelfmarkReleasesResponseObject, error) {
	ctx = requestContext(ctx)
	if err := s.requireShelfmark(ctx); err != nil {
		return nil, err
	}
	list, err := s.api.shelfmark.Releases(ctx, r.Params.Provider, r.Params.Id)
	if err != nil {
		return nil, shelfmarkError(err, "shelfmark_book_not_found")
	}
	out := ListShelfmarkReleases200JSONResponse{Releases: make([]ShelfmarkRelease, 0, len(list.Releases)), Partial: list.Partial}
	if len(list.Releases) == 0 {
		return out, nil
	}
	keys := make([]string, 0, len(list.Releases))
	for _, release := range list.Releases {
		keys = append(keys, release.Key)
	}
	encoded, err := json.Marshal(keys)
	if err != nil {
		return nil, err
	}
	rows, err := s.api.db.Queries.FindShelfmarkReleaseRequests(ctx, string(encoded))
	if err != nil {
		return nil, err
	}
	requests := make(map[string]*ShelfmarkRequestInfo, len(rows))
	for _, row := range rows {
		release, err := shelfmarkRequestedRelease(row)
		if err != nil {
			return nil, err
		}
		requests[release.Key] = release.Request
	}
	for _, item := range list.Releases {
		release := shelfmarkRelease(item)
		release.Request = requests[item.Key]
		if release.Request == nil {
			release.Selection = &item.Selection
		}
		out.Releases = append(out.Releases, release)
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
	key := r.Body.ReleaseKey
	book, release, err := s.api.shelfmark.OpenSelection(r.Body.Provider, r.Body.Id, key, r.Body.Selection)
	if err != nil {
		return nil, adminFailure(http.StatusBadRequest, "shelfmark_invalid_selection")
	}
	row, err := queries.ClaimShelfmarkRelease(ctx, database.ClaimShelfmarkReleaseParams{
		Source: release.Source, ReleaseKey: release.Key, ReleaseTitle: release.Title, ReleaseAuthor: release.Author,
		Format: release.Format, Size: release.Size, Language: release.Language, Indexer: release.Indexer,
		Provider: book.Provider, BookID: book.ID, BookTitle: book.Title, Author: book.Author, Description: book.Description,
		Year: int64(book.Year), HasCover: book.HasCover, Username: username, RequestedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000000000Z"),
	})
	if errors.Is(err, sql.ErrNoRows) {
		row, err = queries.GetShelfmarkRelease(ctx, key)
		if err == nil {
			return s.shelfmarkReleaseResponse(ctx, book, row)
		}
	}
	if err != nil {
		return nil, err
	}

	// Accepted Claim - The single time-bounded POST belongs to the server once the claim is durable.
	dispatch := context.WithoutCancel(ctx)
	err = s.api.shelfmark.Download(dispatch, release)
	settle, cancel := context.WithTimeout(dispatch, 3*time.Second)
	defer cancel()
	var state ShelfmarkRequestInfoState
	switch {
	case errors.Is(err, shelfmark.ErrRejected):
		state = ShelfmarkRejected
	case err == nil:
		state = ShelfmarkQueued
	default:
		return s.shelfmarkReleaseResponse(settle, book, row)
	}
	row.State = string(state)
	if err := queries.SetShelfmarkReleaseState(settle, database.SetShelfmarkReleaseStateParams{ReleaseKey: key, State: row.State}); err != nil {
		return nil, err
	}
	return s.shelfmarkReleaseResponse(settle, book, row)
}

func (s *webAPI) shelfmarkReleaseResponse(ctx context.Context, book shelfmark.Book, row database.ShelfmarkRelease) (CreateShelfmarkRequestResponseObject, error) {
	release, err := shelfmarkRequestedRelease(row)
	if err != nil {
		return nil, err
	}
	count, err := s.api.db.Queries.CountShelfmarkBookRequests(ctx, database.CountShelfmarkBookRequestsParams{Provider: book.Provider, BookID: book.ID})
	return CreateShelfmarkRequest200JSONResponse{Release: release, RequestCount: int(count)}, err
}
