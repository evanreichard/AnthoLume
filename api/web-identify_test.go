package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	log "github.com/sirupsen/logrus"
	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
)

const adminMetadataPath = "/api/v1/admin/metadata-provider"

func TestWebMetadataProviderSelectionAndTokenRemoval(t *testing.T) {
	const token = "synthetic-CATALOG-secret-not-for-storage"
	var logs bytes.Buffer
	logger := log.StandardLogger()
	oldOutput, oldHooks := logger.Out, logger.ReplaceHooks(make(log.LevelHooks))
	oldFormatter, oldLevel, oldCaller := logger.Formatter, logger.Level, logger.ReportCaller
	logger.SetOutput(&logs)
	t.Cleanup(func() {
		logger.SetOutput(oldOutput)
		logger.ReplaceHooks(oldHooks)
		logger.SetFormatter(oldFormatter)
		logger.SetLevel(oldLevel)
		logger.SetReportCaller(oldCaller)
	})
	f := newWebFixture(t)
	assertProblem(t, f.call("GET", adminMetadataPath, nil, nil), 401, "unauthenticated")
	restart := func(token string) {
		f.server.Close()
		require.NoError(t, f.api.Stop())
		t.Setenv("CONFIG_PATH", f.cfg.ConfigPath)
		t.Setenv("DATA_PATH", f.cfg.DataPath)
		t.Setenv("COOKIE_AUTH_KEY", f.cfg.CookieAuthKey)
		t.Setenv("REGISTRATION_ENABLED", "true")
		t.Setenv("HARDCOVER_CLIENT_ID", "")
		t.Setenv("HARDCOVER_CLIENT_SECRET", "")
		t.Setenv("HARDCOVER_TOKEN_KEY", "")
		t.Setenv("HARDCOVER_CATALOG_TOKEN", token)
		var err error
		f.cfg, err = config.Load()
		require.NoError(t, err)
		f.start()
	}
	check := func(selected, effective MetadataProvider, available bool) {
		t.Helper()
		for _, path := range []string{adminMetadataPath, metadataProvidersPath} {
			r := f.call("GET", path, nil, nil)
			require.Equal(t, 200, r.status, string(r.body))
			require.JSONEq(t, fmt.Sprintf(`{"selected":%q,"effective":%q,"hardcover_available":%t}`, selected, effective, available), string(r.body))
		}
	}
	checkStored := func(expected int) {
		t.Helper()
		var count int
		require.NoError(t, f.db.DB.QueryRow(`SELECT COUNT(*) FROM settings WHERE name = 'metadata_provider'`).Scan(&count))
		require.Equal(t, expected, count)
	}
	choice := MetadataProviderChoice{Provider: Hardcover}
	f.register("admin")
	f.exec("UPDATE users SET admin=1 WHERE id='admin'")
	check(Openlibrary, Openlibrary, false)
	assertProblem(t, f.call("PUT", adminMetadataPath, choice, nil), 409, "hardcover_catalog_unconfigured")
	checkStored(0)

	restart(token)
	check(Openlibrary, Openlibrary, true)
	checkStored(0)
	assertProblem(t, f.call("PUT", adminMetadataPath, `{"provider":"hardcover","token":"not allowed"}`, nil), 400, "invalid_request")
	assertProblem(t, f.call("PUT", adminMetadataPath, choice, map[string]string{"X-CSRF-Token": "bad"}), 403, "csrf_failed")
	f.exec("UPDATE users SET admin=0 WHERE id='admin'")
	assertProblem(t, f.call("GET", adminMetadataPath, nil, nil), 403, "forbidden")
	assertProblem(t, f.call("PUT", adminMetadataPath, choice, nil), 403, "forbidden")
	f.exec("UPDATE users SET admin=1 WHERE id='admin'")
	saved := f.call("PUT", adminMetadataPath, choice, nil)
	require.Equal(t, 200, saved.status, string(saved.body))
	require.NotContains(t, string(saved.body), token)
	check(Hardcover, Hardcover, true)
	checkStored(1)
	raw, err := os.ReadFile(filepath.Join(f.cfg.ConfigPath, "test.db"))
	require.NoError(t, err)
	require.NotContains(t, string(raw), token)
	f.exec(`INSERT INTO documents(id,title) VALUES ('book','My Title')`)
	f.exec(`INSERT INTO document_identifiers VALUES ('book','hardcover_book','42')`)

	restart("")
	check(Hardcover, Openlibrary, false)
	assertProblem(t, f.call("GET", "/api/v1/metadata/match?provider=hardcover&work_id=42", nil, nil), 409, "metadata_provider_changed")
	book := decodeWeb[Document](t, f.call("GET", linkedBookPath+"?include=matches", nil, nil))
	require.NotNil(t, book.Matches)
	require.Equal(t, []DocumentMatch{{Provider: Hardcover, WorkId: "42"}}, *book.Matches)
	assertProblem(t, f.call("GET", linkedPreviewPath, nil, nil), 503, "metadata_unavailable")
	assertProblem(t, f.call("GET", "/api/v1/metadata/covers/123?provider=hardcover&document_id=book&work_id=42", nil, nil), 503, "metadata_unavailable")
	retry := f.call("PUT", hardcoverMatchPath, `{"work_id":"42","metadata_mode":"replace_fields"}`, nil)
	require.Equal(t, 200, retry.status, string(retry.body))
	require.JSONEq(t, `{"changed_fields":[]}`, string(retry.body))
	require.Equal(t, 204, f.call("DELETE", linkedPreviewPath, nil, nil).status)
	assertProblem(t, f.call("PUT", hardcoverMatchPath, `{"work_id":"42"}`, nil), 503, "metadata_unavailable")
	require.Equal(t, 200, f.call("PUT", adminMetadataPath, MetadataProviderChoice{Provider: Openlibrary}, nil).status)
	check(Openlibrary, Openlibrary, false)
	checkStored(1)
	f.server.Close()
	require.NotContains(t, logs.String(), token)
}

type identifyCatalogFixture struct{ matcherEngineCatalog }

func (identifyCatalogFixture) CoverFromMatch(context.Context, metadata.LookupMatch) ([]byte, error) {
	return nil, metadata.ErrLookupCoverMissing
}

func (identifyCatalogFixture) Cover(_ context.Context, id int64) ([]byte, error) {
	if id == 123 {
		return []byte("fixture cover"), nil
	}
	return nil, metadata.ErrLookupCoverMissing
}

func (identifyCatalogFixture) Lookup(_ context.Context, q string) ([]metadata.LookupMatch, error) {
	switch q {
	case "Hardcover Author", "9780765391193":
		return []metadata.LookupMatch{{ID: "42", Title: "Found Title", Author: "Hardcover Author"}}, nil
	default:
		return nil, errors.New("synthetic-private-provider-error")
	}
}

func (identifyCatalogFixture) Resolve(_ context.Context, work, edition, isbn string) (metadata.LookupMatch, error) {
	if (work != "42" && work != "43") || (edition != "" || isbn != "") && (edition != "99" || isbn != "9780765391193") {
		return metadata.LookupMatch{}, metadata.ErrInvalidLookupMatch
	}
	m := metadata.LookupMatch{ID: work, Title: "Verified Title", Author: "Verified Author"}
	if edition != "" {
		m.EditionID, m.ISBN13 = &edition, &isbn
	}
	return m, nil
}

type openLibraryCatalogFixture struct{ matcherEngineCatalog }

func (openLibraryCatalogFixture) Lookup(context.Context, string) ([]metadata.LookupMatch, error) {
	return []metadata.LookupMatch{{ID: "OL20W", Title: "Open Library Title"}}, nil
}

func (openLibraryCatalogFixture) Resolve(_ context.Context, work, edition, _ string) (metadata.LookupMatch, error) {
	if edition == "OL503M" {
		return metadata.LookupMatch{}, errors.New("provider unavailable")
	}
	switch work {
	case "OL20W", "OL21W":
		return metadata.LookupMatch{ID: work, Title: "Open Library Title"}, nil
	default:
		return metadata.LookupMatch{}, metadata.ErrInvalidLookupMatch
	}
}

func TestWebDocumentMatch(t *testing.T) {
	f := newWebFixture(t)
	f.api.metadataCatalogs[Hardcover] = identifyCatalogFixture{}
	f.api.metadataCatalogs[Openlibrary] = openLibraryCatalogFixture{}
	setProvider := func(provider MetadataProvider) {
		t.Helper()
		_, err := f.db.Queries.UpdateSettings(t.Context(), database.UpdateSettingsParams{Name: "metadata_provider", Value: string(provider)})
		require.NoError(t, err)
	}
	const path = "/api/v1/documents/book"
	const preview = "/api/v1/metadata/match?provider=hardcover&work_id=42&edition_id=99&isbn=9780765391193"
	const body = `{"match":{"provider":"hardcover","work_id":"42","edition_id":"99","isbn":"9780765391193"}}`
	const coverPath = "/api/v1/metadata/covers/123?provider=hardcover"
	assertProblem(t, f.call("GET", coverPath, nil, nil), 401, "unauthenticated")
	assertProblem(t, f.call("GET", preview, nil, nil), 401, "unauthenticated")
	assertProblem(t, f.call("PATCH", path, body, nil), 401, "unauthenticated")
	f.register("member")
	f.exec(`INSERT INTO documents(id,title,author,description,isbn13) VALUES('book','Original Title','Original Author',' Original description ', '9780804429573')`)
	f.exec(`INSERT INTO document_identifiers VALUES ('book','openlibrary','OL3W'), ('book','openlibrary','OL2M'), ('book','openlibrary','unknown'), ('book','openlibrary_edition','OL5M')`)
	before := decodeWeb[Document](t, f.call("GET", path, nil, nil))
	require.NotNil(t, before.Matches)
	require.Empty(t, *before.Matches)
	assertProblem(t, f.call("PATCH", path, body, nil), 409, "metadata_provider_changed")
	assertProblem(t, f.call("GET", coverPath, nil, nil), 409, "metadata_provider_changed")
	setProvider(Hardcover)
	cover := f.call("GET", coverPath, nil, nil)
	require.Equal(t, 200, cover.status)
	require.Equal(t, "fixture cover", string(cover.body))
	assertProblem(t, f.call("GET", "/api/v1/metadata/covers/1?provider=hardcover", nil, nil), 404, "not_found")
	for _, query := range []string{"Hardcover+Author", "9780765391193"} {
		r := f.call("GET", "/api/v1/metadata/search?q="+query, nil, nil)
		require.Equal(t, 200, r.status, string(r.body))
		matches := decodeWeb[[]MetadataMatch](t, r)
		require.Len(t, matches, 1)
		require.Equal(t, Hardcover, matches[0].Provider)
		require.Equal(t, "42", matches[0].Id)
	}
	providerErr := f.call("GET", "/api/v1/metadata/search?q=fail", nil, nil)
	assertProblem(t, providerErr, 503, "metadata_unavailable")
	require.NotContains(t, string(providerErr.body), "synthetic-private-provider-error")
	assertProblem(t, f.call("GET", "/api/v1/metadata/match?work_id=42", nil, nil), 400, "invalid_request")
	assertProblem(t, f.call("GET", "/api/v1/metadata/match?provider=openlibrary&work_id=OL1W", nil, nil), 409, "metadata_provider_changed")
	assertProblem(t, f.call("GET", "/api/v1/metadata/match?provider=hardcover&work_id=42&edition_id=97&isbn=9780765391193", nil, nil), 400, "invalid_request")
	r := f.call("GET", preview, nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	m := decodeWeb[MetadataMatch](t, r)
	require.Equal(t, "42", m.Id)
	require.Equal(t, "99", *m.EditionId)
	require.Equal(t, "9780765391193", *m.Isbn13)
	assertProblem(t, f.call("PATCH", path, `{"match":{"provider":"hardcover","work_id":"99"},"title":"Do not save"}`, nil), 400, "invalid_request")
	assertProblem(t, f.call("PATCH", path, body, map[string]string{"Origin": "https://elsewhere.invalid"}), 403, "csrf_failed")
	assertProblem(t, f.call("PATCH", "/api/v1/documents/missing", body, nil), 404, "not_found")
	require.Equal(t, before, decodeWeb[Document](t, f.call("GET", path, nil, nil)))
	require.Equal(t, 4, f.count("document_identifiers"))

	patch := func(body string, expected ...DocumentMatch) Document {
		t.Helper()
		r := f.call("PATCH", path, body, nil)
		require.Equal(t, 200, r.status, string(r.body))
		saved := decodeWeb[Document](t, r)
		require.NotNil(t, saved.Matches)
		require.Equal(t, expected, *saved.Matches)
		require.Equal(t, saved.Matches, decodeWeb[Document](t, f.call("GET", path, nil, nil)).Matches)
		return saved
	}
	hc := DocumentMatch{Provider: Hardcover, WorkId: "42"}
	after := patch(body, hc)
	require.Equal(t, before.Title, after.Title)
	require.Equal(t, before.Author, after.Author)
	require.Equal(t, before.Description, after.Description)
	require.Equal(t, before.Isbn13, after.Isbn13)

	// An identifier write failure must roll back the metadata edit and keep the old match.
	f.exec(`CREATE TRIGGER reject_link BEFORE INSERT ON document_identifiers WHEN NEW.value='43' BEGIN SELECT RAISE(ABORT, 'test'); END;`)
	rejected := f.call("PATCH", path, `{"match":{"provider":"hardcover","work_id":"43"},"title":"Do not save"}`, nil)
	require.Equal(t, 500, rejected.status, string(rejected.body))
	live := decodeWeb[Document](t, f.call("GET", path, nil, nil))
	require.Equal(t, after.Title, live.Title)
	require.Equal(t, after.Matches, live.Matches)
	f.exec(`DROP TRIGGER reject_link`)

	setProvider(Openlibrary)
	search := f.call("GET", "/api/v1/metadata/search?q=title", nil, nil)
	require.Equal(t, 200, search.status, string(search.body))
	matches := decodeWeb[[]MetadataMatch](t, search)
	require.Len(t, matches, 1)
	require.Equal(t, Openlibrary, matches[0].Provider)
	require.Equal(t, "OL20W", matches[0].Id)
	assertProblem(t, f.call("PATCH", path, `{"match":{"provider":"openlibrary","work_id":"OL20W","edition_id":"OL100M"}}`, nil), 400, "invalid_request")
	assertProblem(t, f.call("PATCH", path, `{"match":{"provider":"openlibrary","work_id":"OL20W","edition_id":"OL503M"},"title":"Do not save"}`, nil), 503, "metadata_unavailable")
	require.Equal(t, live, decodeWeb[Document](t, f.call("GET", path, nil, nil)))
	ol := DocumentMatch{Provider: Openlibrary, WorkId: "OL20W"}
	patch(`{"match":{"provider":"openlibrary","work_id":"OL20W"}}`, hc, ol)
	ol.WorkId = "OL21W"
	after = patch(`{"match":{"provider":"openlibrary","work_id":"OL21W"},"title":"Selected Title"}`, hc, ol)
	require.Equal(t, "Selected Title", *after.Title)
	require.Equal(t, before.Author, after.Author)
	require.Equal(t, before.Isbn13, after.Isbn13)
	require.Equal(t, 6, f.count("document_identifiers"))

	// Plain edits and detail reads require no live provider connection.
	clear(f.api.metadataCatalogs)
	setProvider(Hardcover)
	patch(`{"author":"Edited Author"}`, hc, ol)
	require.Equal(t, 404, f.call("POST", path+"/identify", `{}`, nil).status)
}
