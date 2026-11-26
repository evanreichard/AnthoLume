package api

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/metadata"
)

type matcherMetadataCatalog struct {
	matcherEngineCatalog
	cover        func(context.Context) ([]byte, error)
	previewCover func(context.Context, int64) ([]byte, error)
}

func (c matcherMetadataCatalog) Cover(ctx context.Context, id int64) ([]byte, error) {
	if c.previewCover == nil {
		return nil, errors.New("matcher confirmation must not look up an image by ID")
	}
	return c.previewCover(ctx, id)
}

func (c matcherMetadataCatalog) CoverFromMatch(ctx context.Context, match metadata.LookupMatch) ([]byte, error) {
	if match.CoverURL == "" {
		return nil, metadata.ErrLookupCoverMissing
	}
	if match.CoverURL != matcherCoverURL {
		return nil, errors.New("unexpected resolved cover URL")
	}
	return c.cover(ctx)
}

const hardcoverMatchPath = "/api/v1/documents/book/matches/hardcover"

func TestMatcherFillsOrReplacesVerifiedMetadata(t *testing.T) {
	for _, mode := range []BookMatcherMetadataMode{FillMissing, ReplaceFields} {
		t.Run(string(mode), func(t *testing.T) {
			f := newWebFixture(t)
			registerMatcherReader(t, f)
			f.exec(`INSERT INTO documents(id,title,author,description,coverfile) VALUES ('book','My Title','  ','My Synopsis','missing.png')`)
			var art bytes.Buffer
			require.NoError(t, png.Encode(&art, image.NewRGBA(image.Rect(0, 0, 12, 16))))
			var resolutions, covers atomic.Int32
			f.api.metadataCatalogs[Hardcover] = matcherMetadataCatalog{matcherEngineCatalog: matcherEngineCatalog{resolve: func(_ context.Context, work, edition, isbn string) (metadata.LookupMatch, error) {
				resolutions.Add(1)
				if work != "42" || edition != "99" || isbn != "9780765391193" {
					return metadata.LookupMatch{}, metadata.ErrInvalidLookupMatch
				}
				return metadata.LookupMatch{ID: work, EditionID: &edition, ISBN10: new("0765391198"), ISBN13: &isbn,
					Title: "Provider Title", Author: "Provider Author", Description: new("  "), CoverID: new(int64(7)), CoverURL: matcherCoverURL}, nil
			}}, cover: func(context.Context) ([]byte, error) {
				covers.Add(1)
				return art.Bytes(), nil
			}}
			body := BookMatcherWork{WorkId: "42", MetadataMode: &mode, EditionId: new("99"), Isbn: new("9780765391193")}
			response := f.call("PUT", hardcoverMatchPath, body, nil)
			require.Equal(t, 200, response.status, string(response.body))
			fields := []BookMatcherChangedField{BookMatcherChangedFieldAuthor, BookMatcherChangedFieldIsbn10, BookMatcherChangedFieldIsbn13, BookMatcherChangedFieldCover}
			wantTitle := "My Title"
			if mode == ReplaceFields {
				fields = append(fields, BookMatcherChangedFieldTitle)
				wantTitle = "Provider Title"
			}
			require.ElementsMatch(t, fields, decodeWeb[BookMatcherConfirmation](t, response).ChangedFields)
			response = f.call("GET", "/api/v1/documents/book", nil, nil)
			require.Equal(t, 200, response.status, string(response.body))
			book := decodeWeb[Document](t, response)
			require.Equal(t, wantTitle, *book.Title)
			require.Equal(t, "Provider Author", *book.Author)
			require.Equal(t, "My Synopsis", *book.Description)
			require.Equal(t, "0765391198", *book.Isbn10)
			require.Equal(t, "9780765391193", *book.Isbn13)
			require.Equal(t, []DocumentMatch{{Provider: Hardcover, WorkId: "42"}}, *book.Matches)
			require.True(t, book.CoverAvailable)
			cover := f.call("GET", "/api/v1/documents/book/cover", nil, nil)
			require.Equal(t, 200, cover.status)
			require.Equal(t, art.Bytes(), cover.body)

			f.exec(`UPDATE documents SET author = 'Later Manual Edit' WHERE id = 'book'`)
			response = f.call("PUT", hardcoverMatchPath, body, nil)
			require.Equal(t, 200, response.status)
			require.JSONEq(t, `{"changed_fields":[]}`, string(response.body))
			require.EqualValues(t, 1, resolutions.Load())
			require.EqualValues(t, 1, covers.Load())
			response = f.call("DELETE", hardcoverMatchPath+"?work_id=42", nil, nil)
			require.Equal(t, 204, response.status)
			book = decodeWeb[Document](t, f.call("GET", "/api/v1/documents/book", nil, nil))
			require.Equal(t, "Later Manual Edit", *book.Author)
			require.True(t, book.CoverAvailable)
			require.Empty(t, *book.Matches)
		})
	}
}

func TestMatcherRejectsUnverifiedEditionEvidence(t *testing.T) {
	f := newWebFixture(t)
	registerMatcherReader(t, f)
	f.exec(`INSERT INTO documents(id,title) VALUES ('book','Original')`)
	f.api.metadataCatalogs[Openlibrary] = matcherEngineCatalog{resolve: func(_ context.Context, work, edition, _ string) (metadata.LookupMatch, error) {
		match := metadata.LookupMatch{ID: work, Title: "Catalog Title", Description: new("Synopsis"), ISBN10: new("0306406152")}
		if edition == "OL2M" {
			match.EditionID = &edition
		}
		return match, nil
	}}
	path := "/api/v1/documents/book/matches/openlibrary"
	for _, invalid := range []string{
		`{"work_id":"OL1W","metadata_mode":"overwrite"}`,
		`{"work_id":"OL1W","metadata_mode":"replace_fields","edition_id":"OL1M","isbn":"9780765391193"}`,
		`{"work_id":"OL1W","metadata_mode":"replace_fields","edition_id":"OL2M","isbn":"9780765391193"}`,
		`{"work_id":"OL1W","metadata_mode":"replace_fields","isbn":"9780765391192"}`,
	} {
		assertProblem(t, f.call("PUT", path, invalid, nil), 400, "invalid_request")
	}
	require.Equal(t, 0, f.count("document_identifiers"))
	book := decodeWeb[Document](t, f.call("GET", "/api/v1/documents/book", nil, nil))
	require.Equal(t, "Original", *book.Title)
	response := f.call("PUT", path, `{"work_id":"OL1W","metadata_mode":"replace_fields"}`, nil)
	require.Equal(t, 200, response.status, string(response.body))
	require.JSONEq(t, `{"changed_fields":["title","description"]}`, string(response.body))
	book = decodeWeb[Document](t, f.call("GET", "/api/v1/documents/book", nil, nil))
	require.Nil(t, book.Isbn10, "work metadata is not edition evidence")
}

func TestMatcherMetadataAndStagedArtRespectLatestBook(t *testing.T) {
	for _, conflict := range []bool{false, true} {
		name := "fill preserves changes made during resolution"
		if conflict {
			name = "competing link aborts the metadata write"
		}
		t.Run(name, func(t *testing.T) {
			f := newWebFixture(t)
			registerMatcherReader(t, f)
			f.exec(`INSERT INTO documents(id,title) VALUES ('book','Original')`)
			var art bytes.Buffer
			require.NoError(t, png.Encode(&art, image.NewRGBA(image.Rect(0, 0, 12, 16))))
			started, release := make(chan struct{}), make(chan struct{})
			defer func() {
				select {
				case <-release:
				default:
					close(release)
				}
			}()
			f.api.metadataCatalogs[Hardcover] = matcherMetadataCatalog{matcherEngineCatalog: matcherEngineCatalog{resolve: func(_ context.Context, work, _, _ string) (metadata.LookupMatch, error) {
				return metadata.LookupMatch{ID: work, Title: "Catalog Title", Author: "Catalog Author", Description: new("Catalog Synopsis"), CoverID: new(int64(7)), CoverURL: matcherCoverURL}, nil
			}}, cover: func(ctx context.Context) ([]byte, error) {
				close(started)
				select {
				case <-release:
					return art.Bytes(), nil
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			}}
			r := f.newRequest("PUT", hardcoverMatchPath, `{"work_id":"42","metadata_mode":"fill_missing"}`, nil)
			type result struct {
				response webResponse
				err      error
			}
			responses := make(chan result, 1)
			go func() {
				response, err := f.client.Do(r)
				if err != nil {
					responses <- result{err: err}
					return
				}
				defer response.Body.Close()
				body, err := io.ReadAll(response.Body)
				responses <- result{response: webResponse{response.StatusCode, response.Header, body}, err: err}
			}()
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				t.Fatal("cover fetch did not start")
			}
			if conflict {
				f.exec(`INSERT INTO document_identifiers VALUES ('book','hardcover_book','43')`)
			}
			coversDir := filepath.Join(f.cfg.DataPath, "covers")
			require.NoError(t, os.WriteFile(filepath.Join(coversDir, "manual.png"), art.Bytes(), 0600))
			f.exec(`UPDATE documents SET author = 'Manual Author', coverfile = 'manual.png' WHERE id = 'book'`)
			close(release)
			outcome := <-responses
			require.NoError(t, outcome.err)
			response := outcome.response
			if conflict {
				assertProblem(t, response, 409, "book_match_changed")
			} else {
				require.Equal(t, 200, response.status, string(response.body))
				require.JSONEq(t, `{"changed_fields":["description"]}`, string(response.body))
			}
			files, err := os.ReadDir(coversDir)
			require.NoError(t, err)
			require.Len(t, files, 1, "unused staged art should be removed")
			require.Equal(t, "manual.png", files[0].Name())
			book := decodeWeb[Document](t, f.call("GET", "/api/v1/documents/book", nil, nil))
			require.Equal(t, "Manual Author", *book.Author)
			if conflict {
				require.Nil(t, book.Description)
				require.Equal(t, []DocumentMatch{{Provider: Hardcover, WorkId: "43"}}, *book.Matches)
			}
		})
	}
}

func TestMatcherRollsBackMetadataWhenLinkCannotBeSaved(t *testing.T) {
	f := newWebFixture(t)
	registerMatcherReader(t, f)
	f.exec(`INSERT INTO documents(id,title) VALUES ('book','Original')`)
	f.exec(`CREATE TRIGGER refuse_test_link BEFORE INSERT ON document_identifiers BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END`)
	var art bytes.Buffer
	require.NoError(t, png.Encode(&art, image.NewRGBA(image.Rect(0, 0, 12, 16))))
	f.api.metadataCatalogs[Hardcover] = matcherMetadataCatalog{matcherEngineCatalog: matcherEngineCatalog{resolve: func(_ context.Context, work, _, _ string) (metadata.LookupMatch, error) {
		return metadata.LookupMatch{ID: work, Title: "Catalog Title", CoverID: new(int64(7)), CoverURL: matcherCoverURL}, nil
	}}, cover: func(context.Context) ([]byte, error) { return art.Bytes(), nil }}
	response := f.call("PUT", hardcoverMatchPath, `{"work_id":"42","metadata_mode":"replace_fields"}`, nil)
	require.Equal(t, 500, response.status, string(response.body))
	book := decodeWeb[Document](t, f.call("GET", "/api/v1/documents/book", nil, nil))
	require.Equal(t, "Original", *book.Title)
	require.False(t, book.CoverAvailable)
	require.Empty(t, *book.Matches)
	covers, err := os.ReadDir(filepath.Join(f.cfg.DataPath, "covers"))
	require.NoError(t, err)
	require.Empty(t, covers, "rolled-back artwork should not remain on disk")
}
