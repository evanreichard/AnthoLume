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
		r := f.call("GET", adminMetadataPath, nil, nil)
		require.Equal(t, 200, r.status, string(r.body))
		require.JSONEq(t, fmt.Sprintf(`{"selected":%q,"effective":%q,"hardcover_available":%t}`, selected, effective, available), string(r.body))
	}
	choice := MetadataProviderChoice{Provider: Hardcover}
	f.register("admin")
	f.exec("UPDATE users SET admin=1 WHERE id='admin'")
	check(Openlibrary, Openlibrary, false)
	assertProblem(t, f.call("PUT", adminMetadataPath, choice, nil), 409, "hardcover_catalog_unconfigured")
	require.Zero(t, f.count("metadata_provider"))

	restart(token)
	check(Openlibrary, Openlibrary, true)
	require.Zero(t, f.count("metadata_provider"))
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
	require.Equal(t, 1, f.count("metadata_provider"))
	raw, err := os.ReadFile(filepath.Join(f.cfg.ConfigPath, "test.db"))
	require.NoError(t, err)
	require.NotContains(t, string(raw), token)

	restart("")
	check(Hardcover, Openlibrary, false)
	assertProblem(t, f.call("GET", "/api/v1/metadata/match?work_id=42", nil, nil), 409, "metadata_provider_changed")
	require.Equal(t, 200, f.call("PUT", adminMetadataPath, MetadataProviderChoice{Provider: Openlibrary}, nil).status)
	check(Openlibrary, Openlibrary, false)
	f.server.Close()
	require.NotContains(t, logs.String(), token)
}

type identifyCatalogFixture struct{}

func (identifyCatalogFixture) Lookup(_ context.Context, q string) ([]metadata.LookupMatch, error) {
	switch q {
	case "Hardcover Author", "9780765391193":
		return []metadata.LookupMatch{{ID: "42", Title: "Found Title", Author: "Hardcover Author"}}, nil
	default:
		return nil, errors.New("synthetic-private-provider-error")
	}
}

func (identifyCatalogFixture) Resolve(_ context.Context, work, edition, isbn string) (metadata.LookupMatch, error) {
	if work != "42" || (edition != "" || isbn != "") && (edition != "99" || isbn != "9780765391193") {
		return metadata.LookupMatch{}, metadata.ErrInvalidLookupMatch
	}
	m := metadata.LookupMatch{ID: work, Title: "Verified Title", Author: "Verified Author"}
	if edition != "" {
		m.EditionID, m.ISBN13 = &edition, &isbn
	}
	return m, nil
}

func TestWebIdentifyHardcoverPreviewConfirmationAndLinkOnly(t *testing.T) {
	f := newWebFixture(t)
	f.api.catalog = identifyCatalogFixture{}
	const identify = "/api/v1/documents/book/identify"
	const preview = "/api/v1/metadata/match?work_id=42&edition_id=99&isbn=9780765391193"
	const body = `{"work_id":"42","edition_id":"99","isbn":"9780765391193","fields":[]}`
	assertProblem(t, f.call("GET", preview, nil, nil), 401, "unauthenticated")
	assertProblem(t, f.call("POST", identify, body, nil), 401, "unauthenticated")
	f.register("member")
	f.exec(`INSERT INTO documents(id,title,author,description,isbn13) VALUES('book','Original Title','Original Author',' Original description ', '9780804429573')`)
	f.exec(`INSERT INTO document_identifiers VALUES ('book','openlibrary','OL3W')`)
	assertProblem(t, f.call("POST", identify, body, nil), 409, "metadata_provider_changed")
	require.NoError(t, f.db.Queries.SetMetadataProvider(t.Context(), "hardcover"))
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
	assertProblem(t, f.call("GET", "/api/v1/metadata/match?work_id=OL1W", nil, nil), 409, "metadata_provider_changed")
	assertProblem(t, f.call("GET", "/api/v1/metadata/match?work_id=42&edition_id=97&isbn=9780765391193", nil, nil), 400, "invalid_request")
	before := decodeWeb[Document](t, f.call("GET", "/api/v1/documents/book", nil, nil))
	r := f.call("GET", preview, nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	m := decodeWeb[MetadataMatch](t, r)
	require.Equal(t, "42", m.Id)
	require.Equal(t, "99", *m.EditionId)
	require.Equal(t, "9780765391193", *m.Isbn13)
	assertProblem(t, f.call("POST", identify, `{"work_id":"99","fields":[]}`, nil), 400, "invalid_request")
	assertProblem(t, f.call("POST", identify, `{"work_id":"42","fields":["isbn13"]}`, nil), 400, "invalid_request")
	assertProblem(t, f.call("POST", identify, body, map[string]string{"Origin": "https://elsewhere.invalid"}), 403, "csrf_failed")
	assertProblem(t, f.call("POST", "/api/v1/documents/missing/identify", body, nil), 404, "not_found")
	require.Equal(t, before, decodeWeb[Document](t, f.call("GET", "/api/v1/documents/book", nil, nil)))
	require.Equal(t, 1, f.count("document_identifiers"))

	r = f.call("POST", identify, body, nil)
	require.Equal(t, 200, r.status, string(r.body))
	after := decodeWeb[Document](t, r)
	require.Equal(t, before.Title, after.Title)
	require.Equal(t, before.Author, after.Author)
	require.Equal(t, before.Description, after.Description)
	require.Equal(t, before.Isbn13, after.Isbn13)
	var linked string
	require.NoError(t, f.db.DB.QueryRow(`SELECT value FROM document_identifiers WHERE document_id='book' AND namespace='hardcover'`).Scan(&linked))
	require.Equal(t, "42", linked)

	r = f.call("POST", identify, `{"work_id":"42","edition_id":"99","isbn":"9780765391193","fields":["title","isbn13"]}`, nil)
	require.Equal(t, 200, r.status, string(r.body))
	after = decodeWeb[Document](t, r)
	require.Equal(t, "Verified Title", *after.Title)
	require.Equal(t, "9780765391193", *after.Isbn13)
	require.Equal(t, before.Author, after.Author)
	require.Equal(t, before.Description, after.Description)
	require.Equal(t, 2, f.count("document_identifiers"))
}
