package shelfmark

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestReleaseApproval(t *testing.T) {
	m := newReleaseMatcher(metadataBook{Title: "Dune", Authors: []string{"Frank Herbert"}, ISBN13: "9780804429573", Language: "en"})
	const sameISBN = `{"ISBN-10":["0-8044-2957-X"]}`
	const differentISBN = `{"ISBN-13":["9780140328721"]}`
	for _, tc := range []struct {
		name, title, author, format, content, language, info, want string
	}{
		{"release byline", "Dune.epub", "Herbert, Frank", "", "", "en", "", "title_author"},
		{"filename byline", "Frank Herbert — Dune [EPUB]", "", "", "", "en", "", "title_author"},
		{"filename suffix byline", "DUNE by Frank Herbert", "", "", "ebook", "en", "", "title_author"},
		{"filename with isbn and author", "Frank Herbert - Dune [ISBN: 9780804429573].epub", "", "", "", "en", "", "title_author"},
		{"structured equivalent isbn", "Dune", "", "pdf", "", "en", sameISBN, "isbn"},
		{"no release byline", "Dune.epub", "", "epub", "", "en", "", ""},
		{"sequel", "Dune Messiah", "Frank Herbert", "epub", "", "en", "", ""},
		{"collection", "Frank Herbert - Dune Books 1–3 [EPUB]", "", "epub", "", "en", "", ""},
		{"study guide despite isbn", "Study Guide to Dune", "Frank Herbert", "epub", "", "en", sameISBN, ""},
		{"contradictory byline", "Frank Herbert - Dune", "Another Author", "epub", "", "en", sameISBN, ""},
		{"filename isbn alone", "Dune [9780804429573]", "", "epub", "", "en", "", ""},
		{"conflicting isbn", "Dune", "Frank Herbert", "epub", "", "en", differentISBN, ""},
		{"conflicting filename isbn", "Dune [9780140328721]", "Frank Herbert", "epub", "", "en", sameISBN, ""},
		{"conflicting language", "Dune", "Frank Herbert", "epub", "", "fr", "", ""},
		{"missing required language", "Dune", "Frank Herbert", "epub", "", "", "", ""},
		{"wrong content", "Dune", "Frank Herbert", "epub", "audiobook", "en", sameISBN, ""},
		{"wrong format", "Dune", "Frank Herbert", "mp3", "ebook", "en", "", ""},
		{"no ebook evidence", "Dune", "Frank Herbert", "", "", "en", "", ""},
		{"generic book category alone", "Dune", "Frank Herbert", "", "book", "en", "", ""},
		{"generic book category with ebook format", "Dune", "Frank Herbert", "epub", "book", "en", "", "title_author"},
		{"qualified book category", "Dune", "Frank Herbert", "epub", "Book (fiction)", "en", "", "title_author"},
		{"longer word is not book", "Dune", "Frank Herbert", "epub", "booklet", "en", "", ""},
		{"book is not the first word", "Dune", "Frank Herbert", "epub", "audio book", "en", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			content, err := json.Marshal(tc.content)
			require.NoError(t, err)
			item := verifiedRelease{release: Release{Title: tc.title, Author: tc.author, Format: tc.format, Language: tc.language}, contentType: content, info: json.RawMessage(tc.info)}
			require.Equal(t, tc.want, m.approvalBasis(item, m.isbnEvidence(item)))
		})
	}
}

func TestApprovalRequiresCatalogSubtitle(t *testing.T) {
	const subtitle = "The Graphic Novel, Book 1"
	const full = "Dune: " + subtitle
	for _, catalogTitle := range []string{"Dune", full} {
		t.Run(catalogTitle, func(t *testing.T) {
			m := newReleaseMatcher(metadataBook{Title: catalogTitle, Subtitle: subtitle, Authors: []string{"Frank Herbert"}, Language: "en"})
			for _, tc := range []struct{ listing, want string }{
				{"Dune.epub", ""}, {"Dune: The Graphic Novel, Book 2.epub", ""}, {full + ".epub", "title_author"},
			} {
				item := verifiedRelease{release: Release{Title: tc.listing, Author: "Frank Herbert", Language: "en"}}
				require.Equal(t, tc.want, m.approvalBasis(item, isbnEvidence{}), tc.listing)
			}
		})
	}
}

func TestLocalizedSearchTitleCannotDropVolume(t *testing.T) {
	c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"book":{"provider":"hardcover","provider_id":"vol2","title":"Dune: The Graphic Novel, Book 2","subtitle":"The Graphic Novel","authors":["Frank Herbert"],"language":"en","titles_by_language":{"en":"Dune: The Graphic Novel"}},"releases":[{"source":"index","source_id":"id","title":"Dune: The Graphic Novel.epub","author":"Frank Herbert","language":"en"}]}`)
	}, "")
	list, err := c.Releases(t.Context(), "hardcover", "vol2")
	require.NoError(t, err)
	require.Nil(t, list.Recommendation)
	require.Len(t, list.Releases, 1)
	require.NotEmpty(t, list.Releases[0].Selection)
}

func TestStructuredReleaseEvidence(t *testing.T) {
	for _, tc := range []struct{ name, extra, basis string }{
		{"no structured metadata", `{}`, "title_author"},
		{"matching structured title", `{"book_title":"DUNE"}`, "title_author"},
		{"conflicting structured title", `{"book_title":"Dune Messiah"}`, ""},
		{"isbn cannot override title", `{"book_title":"Dune Messiah","info":{"ISBN-13":["9780804429573"]}}`, ""},
		{"same series and volume", `{"series_name":"DUNE chronicles","series_position":1.5}`, "title_author"},
		{"different volume in same series", `{"series_name":"Dune Chronicles","series_position":1}`, ""},
		{"isbn cannot override volume", `{"series_name":"Dune Chronicles","series_position":0,"info":{"ISBN-13":["9780804429573"]}}`, ""},
		{"different series numbering", `{"series_name":"Another collection","series_position":1}`, "title_author"},
		{"no comparable position", `{"series_name":"Dune Chronicles","series_position":null}`, "title_author"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
				fmt.Fprintf(w, `{"book":{"provider":"hardcover","provider_id":"id","title":"Dune","authors":["Frank Herbert"],"series_name":"Dune Chronicles","series_position":1.5,"isbn_13":"9780804429573"},"releases":[{"source":"index","source_id":"id","title":"Dune.epub","author":"Frank Herbert","extra":%s}]}`, tc.extra)
			}, "")
			list, err := c.Releases(t.Context(), "hardcover", "id")
			require.NoError(t, err)
			require.Len(t, list.Releases, 1)
			require.NotEmpty(t, list.Releases[0].Selection)
			if tc.basis == "" {
				require.Nil(t, list.Recommendation)
			} else {
				require.Equal(t, &Recommendation{list.Releases[0].Key, tc.basis}, list.Recommendation)
			}
		})
	}
}

func TestApprovalChecksBothReportedBylines(t *testing.T) {
	m := newReleaseMatcher(metadataBook{Title: "Dune", Authors: []string{"Frank Herbert"}, ISBN13: "9780804429573"})
	for _, tc := range []struct{ author, extra, isbn, want string }{
		{"Frank Herbert", "Brian Herbert", "", ""},
		{"Brian Herbert", "Frank Herbert", "", ""},
		{"Frank Herbert", "Brian Herbert", "9780804429573", ""},
		{"Herbert, Frank", "Frank Herbert", "", "title_author"},
		{"Frank Herbert", "", "9780804429573", "isbn"},
	} {
		raw := fmt.Sprintf(`{"source":"index","source_id":"id","title":"Dune.epub","author":%q,"extra":{"author":%q,"info":{"ISBN-13":[%q]}}}`, tc.author, tc.extra, tc.isbn)
		item, ok := verifyRelease(json.RawMessage(raw))
		require.True(t, ok)
		require.Equal(t, tc.author, item.release.Author)
		require.Equal(t, tc.want, m.approvalBasis(item, m.isbnEvidence(item)), raw)
	}
}

func TestOnlyPromoteFirstApprovedRelease(t *testing.T) {
	const highScore = `{"source":"index","source_id":"near","title":"The Time Machine Companion [9780804429573]","format":"epub"}`
	const first = `{"source":"index","source_id":"one","title":"H. G. Wells - The Time Machine [epub]"}`
	const second = `{"source":"index","source_id":"two","title":"The Time Machine by H. G. Wells (PDF)"}`
	const lowScore = `{"source":"index","source_id":"weak","title":"Unknown"}`
	for _, approve := range []bool{false, true} {
		t.Run(fmt.Sprintf("approved=%t", approve), func(t *testing.T) {
			rows := []string{lowScore, highScore}
			if approve {
				rows = append(rows, first, second)
			}
			c := testClient(t, func(w http.ResponseWriter, _ *http.Request) {
				fmt.Fprintf(w, `{"book":{"title":"The Time Machine","authors":["H. G. Wells"],"isbn_13":"9780804429573","provider":"hardcover","provider_id":"id"},"releases":[%s]}`, strings.Join(rows, ","))
			}, "")
			list, err := c.Releases(t.Context(), "hardcover", "id")
			require.NoError(t, err)
			titles := make([]string, 0, len(list.Releases))
			for _, item := range list.Releases {
				titles = append(titles, item.Title)
			}
			if approve {
				require.Equal(t, &Recommendation{list.Releases[0].Key, "title_author"}, list.Recommendation)
				require.Equal(t, []string{"H. G. Wells - The Time Machine [epub]", "The Time Machine Companion [9780804429573]", "The Time Machine by H. G. Wells (PDF)", "Unknown"}, titles)
			} else {
				require.Nil(t, list.Recommendation)
				require.Equal(t, []string{"The Time Machine Companion [9780804429573]", "Unknown"}, titles)
			}
		})
	}
}
