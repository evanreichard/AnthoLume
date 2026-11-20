package api

import (
	"encoding/base64"
	"encoding/xml"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/opds"
)

func TestOPDSPublishedOpaqueLinksReachOriginalResources(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	book, err := os.ReadFile("../_test_files/alice.epub")
	require.NoError(t, err)
	cover := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>`)
	require.NoError(t, os.WriteFile(filepath.Join(f.cfg.DataPath, "documents", "public.EPUB"), book, 0600))
	require.NoError(t, os.WriteFile(filepath.Join(f.cfg.DataPath, "covers", "public.svg"), cover, 0600))
	ids := []string{"ascii-control", "plus+id", "slash/id", "percent%id", "unicode-é-书", "query?id=a&next=b#part"}
	for _, id := range ids {
		f.exec("INSERT INTO documents(id,title,filepath,coverfile) VALUES(?,?,?,?)", id, id, "public.EPUB", "public.svg")
	}
	headers := map[string]string{"Authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte("alice:password"))}
	baseline := f.call("GET", "/api/opds/documents/ascii-control/file", nil, headers)
	require.Equal(t, 200, baseline.status)
	require.Equal(t, book, baseline.body)
	require.NotEmpty(t, baseline.header.Get("Content-Type"))
	// OPDS Wire - Parse the real feed definitions and follow its published attributes, not independently constructed resource URLs.
	response := f.call("GET", "/api/opds/documents", nil, headers)
	require.Equal(t, 200, response.status, string(response.body))
	require.Contains(t, string(response.body), "&amp;")
	var feed opds.Feed
	require.NoError(t, xml.Unmarshal(response.body, &feed))
	require.Len(t, feed.Entries, len(ids))
	seen := map[string]bool{}
	for _, entry := range feed.Entries {
		require.Contains(t, ids, entry.Title)
		seen[entry.Title] = true
		require.Len(t, entry.Links, 2)
		for _, link := range entry.Links {
			parsed, err := url.Parse(link.Href)
			require.NoError(t, err, link.Href)
			require.False(t, parsed.IsAbs())
			require.Empty(t, parsed.RawQuery)
			require.Empty(t, parsed.Fragment)
			require.True(t, strings.HasPrefix(parsed.Path, "/api/opds/documents/"))
			result := f.call("GET", link.Href, nil, headers)
			require.Equal(t, 200, result.status, link.Href)
			switch link.Rel {
			case "http://opds-spec.org/acquisition":
				require.Equal(t, "/api/opds/documents/"+entry.Title+"/file", parsed.Path)
				require.Equal(t, book, result.body)
				require.Equal(t, "application/epub+zip", link.TypeLink)
				require.Equal(t, baseline.header.Get("Content-Type"), result.header.Get("Content-Type"))
			case "http://opds-spec.org/image":
				require.Equal(t, "/api/opds/documents/"+entry.Title+"/cover", parsed.Path)
				require.Equal(t, cover, result.body)
				require.Equal(t, "image/jpeg", link.TypeLink)
				require.Contains(t, result.header.Get("Content-Type"), "image/svg+xml")
				requireCoverPolicy(t, result)
			default:
				t.Fatalf("unexpected resource relation: %s", link.Rel)
			}
		}
	}
	require.Len(t, seen, len(ids))
}
