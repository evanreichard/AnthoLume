package api

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
	"reichard.io/antholume/matcherquota"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/reading"
)

type matcherCoverFixture struct {
	identifyCatalogFixture
	cover func(context.Context, string) ([]byte, error)
}

const matcherCoverURL = "https://assets.hardcover.app/edition/77/cover"

func (f matcherCoverFixture) CoverFromURL(ctx context.Context, url string) ([]byte, error) {
	return f.cover(ctx, url)
}

func TestStageMatcherCover(t *testing.T) {
	var jpegCover, pngCover, placeholder, hugeImage bytes.Buffer
	book := image.NewRGBA(image.Rect(0, 0, 8, 12))
	require.NoError(t, jpeg.Encode(&jpegCover, book, nil))
	require.NoError(t, png.Encode(&pngCover, book))
	require.NoError(t, png.Encode(&placeholder, image.NewRGBA(image.Rect(0, 0, 1, 1))))
	require.NoError(t, png.Encode(&hugeImage, image.NewRGBA(image.Rect(0, 0, 4097, 2))))
	corrupt := jpegCover.Bytes()[:jpegCover.Len()-2]
	_, _, err := image.DecodeConfig(bytes.NewReader(corrupt))
	require.NoError(t, err, "payload must get past the header check")
	for _, tc := range []struct {
		name     string
		body     []byte
		coverErr error
		ext      string
		status   int
		code     string
	}{
		{name: "verified JPEG", body: jpegCover.Bytes(), ext: ".jpg"},
		{name: "verified PNG", body: pngCover.Bytes(), ext: ".png"},
		{name: "missing", coverErr: metadata.ErrLookupCoverMissing},
		{name: "not an image", body: []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)},
		{name: "broken image after valid header", body: corrupt},
		{name: "provider placeholder", body: placeholder.Bytes()},
		{name: "unsafe dimensions", body: hugeImage.Bytes()},
		{name: "too large", body: make([]byte, 2<<20+1)},
		{name: "upstream rate limit", coverErr: matcherquota.ErrLimited, status: http.StatusTooManyRequests, code: "rate_limited"},
		{name: "upstream unavailable", coverErr: errors.New("private upstream error"), status: http.StatusServiceUnavailable, code: "metadata_unavailable"},
		{name: "upstream timeout", coverErr: context.DeadlineExceeded, status: http.StatusServiceUnavailable, code: "metadata_unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := t.TempDir()
			covers := filepath.Join(data, "covers")
			require.NoError(t, os.Mkdir(covers, 0700))
			api := &API{cfg: &config.Config{DataPath: data}, hardcoverCatalog: matcherCoverFixture{
				cover: func(_ context.Context, url string) ([]byte, error) {
					require.Equal(t, matcherCoverURL, url)
					return tc.body, tc.coverErr
				},
			}}
			staged, err := api.stageMatcherCover(t.Context(), Hardcover, metadata.LookupMatch{CoverID: new(int64(123)), CoverURL: matcherCoverURL})
			if tc.status != 0 {
				var problem *reading.Failure
				require.ErrorAs(t, err, &problem)
				require.Equal(t, tc.status, problem.Status)
				require.Equal(t, tc.code, problem.Code)
			} else {
				require.NoError(t, err)
			}
			if tc.ext != "" {
				require.Equal(t, staged, filepath.Base(staged))
				require.Equal(t, tc.ext, filepath.Ext(staged))
				path := filepath.Join(covers, staged)
				body, err := os.ReadFile(path)
				require.NoError(t, err)
				require.Equal(t, tc.body, body)
				require.NoError(t, os.Remove(path), "caller must be able to discard the staged file")
			} else {
				require.Empty(t, staged)
			}
			entries, err := os.ReadDir(covers)
			require.NoError(t, err)
			require.Empty(t, entries)
		})
	}
}

func TestMatcherDoesNotLookUpCoverByID(t *testing.T) {
	f := newWebFixture(t)
	registerMatcherReader(t, f)
	f.exec(`INSERT INTO documents(id,title) VALUES ('book','Original'), ('without-art','Original')`)
	f.api.hardcoverCatalog = matcherMetadataCatalog{
		matcherEngineCatalog: matcherEngineCatalog{resolve: func(_ context.Context, work, _, _ string) (metadata.LookupMatch, error) {
			match := metadata.LookupMatch{ID: work, Title: "Provider Title", CoverID: new(int64(123))}
			if work == "42" {
				match.CoverURL = matcherCoverURL
			}
			return match, nil
		}},
		cover: func(context.Context) ([]byte, error) { return nil, errors.New("unexpected artwork download") },
	}
	response := f.call("PUT", hardcoverMatchPath, `{"work_id":"42"}`, nil)
	require.Equal(t, 204, response.status, string(response.body))
	response = f.call("PUT", "/api/v1/documents/without-art/matches/hardcover", `{"work_id":"43","metadata_mode":"replace_fields"}`, nil)
	require.Equal(t, 200, response.status, string(response.body))
	require.JSONEq(t, `{"changed_fields":["title"]}`, string(response.body))
}

func TestMatcherAndIdentifyReportCoverRateLimits(t *testing.T) {
	f := newWebFixture(t)
	registerMatcherReader(t, f)
	f.exec(`INSERT INTO documents(id,title) VALUES ('book','Original')`)
	f.api.hardcoverCatalog = matcherMetadataCatalog{
		matcherEngineCatalog: matcherEngineCatalog{resolve: func(_ context.Context, work, _, _ string) (metadata.LookupMatch, error) {
			return metadata.LookupMatch{ID: work, Title: "Provider Title", CoverID: new(int64(123)), CoverURL: matcherCoverURL}, nil
		}},
		cover:        func(context.Context) ([]byte, error) { return nil, matcherquota.ErrLimited },
		previewCover: func(context.Context, int64) ([]byte, error) { return nil, matcherquota.ErrLimited },
	}
	assertProblem(t, f.call("PUT", hardcoverMatchPath, `{"work_id":"42","metadata_mode":"replace_fields"}`, nil), 429, "rate_limited")
	book := decodeWeb[Document](t, f.call("GET", linkedBookPath, nil, nil))
	require.Equal(t, "Original", *book.Title)
	require.Empty(t, book.Matches)
	require.False(t, book.CoverAvailable)

	f.exec(`INSERT INTO document_identifiers VALUES ('book','hardcover_book','42')`)
	const preview = "/api/v1/metadata/covers/123?provider=hardcover&document_id=book&work_id=42"
	assertProblem(t, f.call("GET", preview, nil, nil), 429, "rate_limited")
}

func TestStageMatcherCoverDiscardsCancelledFetch(t *testing.T) {
	data := t.TempDir()
	covers := filepath.Join(data, "covers")
	require.NoError(t, os.Mkdir(covers, 0700))
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	var raw bytes.Buffer
	require.NoError(t, jpeg.Encode(&raw, image.NewRGBA(image.Rect(0, 0, 8, 12)), nil))
	api := &API{cfg: &config.Config{DataPath: data}, hardcoverCatalog: matcherCoverFixture{
		cover: func(fetchContext context.Context, _ string) ([]byte, error) {
			require.NoError(t, fetchContext.Err())
			cancel()
			return raw.Bytes(), nil
		},
	}}
	staged, err := api.stageMatcherCover(ctx, Hardcover, metadata.LookupMatch{CoverID: new(int64(123)), CoverURL: matcherCoverURL})
	require.ErrorIs(t, err, context.Canceled)
	require.Empty(t, staged)
	entries, err := os.ReadDir(covers)
	require.NoError(t, err)
	require.Empty(t, entries)
}
