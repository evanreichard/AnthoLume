package metadata

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"reichard.io/antholume/matcherquota"
)

type LookupMatch struct {
	ID, Title, Author               string
	Year                            *int
	CoverID                         *int64
	CoverURL                        string `json:"-"`
	Description                     *string
	EditionID, Publisher, Published *string
	ISBN10, ISBN13                  *string
}

var lookupClient = &http.Client{Timeout: 6 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

type OpenLibraryCatalog struct{}

const openLibraryBase = "https://openlibrary.org"
const openLibrarySearchFields = "key,title,author_name,first_publish_year,cover_edition_key,cover_i"

func (OpenLibraryCatalog) Lookup(ctx context.Context, query string) ([]LookupMatch, error) {
	return lookupOpenLibrary(ctx, openLibraryMatcherQuota.Client(lookupClient, 1), openLibraryBase+"/search.json", query)
}

var lookupISBN = regexp.MustCompile(`^(?:[0-9]{13}|[0-9]{9}[0-9X])$`)

func lookupOpenLibrary(ctx context.Context, client matcherquota.Doer, endpoint, query string) ([]LookupMatch, error) {
	isbn := MatcherISBN(query)
	params := url.Values{"q": {query}, "limit": {"8"}, "fields": {openLibrarySearchFields}}
	if isbn != "" {
		params.Set("q", "isbn:"+isbn)
		params.Set("fields", params.Get("fields")+",isbn")
	}
	docs, err := searchOpenLibrary(ctx, client, endpoint, params)
	if err != nil {
		return nil, err
	}
	out := make([]LookupMatch, 0, 8)
	seen := make(map[string]bool)
	for _, d := range docs {
		m := d.match()
		if m.ID == "" || seen[m.ID] {
			continue
		}
		seen[m.ID] = true
		for _, value := range d.ISBN {
			if isbn == "" || value != isbn {
				continue
			}
			if len(value) == 10 {
				m.ISBN10 = &value
			} else {
				m.ISBN13 = &value
			}
			break
		}
		out = append(out, m)
		if len(out) == 8 {
			break
		}
	}
	return out, nil
}

type openLibrarySearchDoc struct {
	Key        string   `json:"key"`
	Title      string   `json:"title"`
	Authors    []string `json:"author_name"`
	Year       *int     `json:"first_publish_year"`
	EditionKey string   `json:"cover_edition_key"`
	CoverID    int64    `json:"cover_i"`
	ISBN       []string `json:"isbn"`
}

func (d openLibrarySearchDoc) match() LookupMatch {
	title := lookupText(d.Title, 512)
	key := strings.TrimPrefix(d.Key, "/works/")
	if title == "" || !workID.MatchString(key) {
		return LookupMatch{}
	}
	m := LookupMatch{ID: key, Title: title, Author: lookupText(strings.Join(d.Authors, ", "), 512), Year: d.Year}
	if d.CoverID > 0 && d.CoverID <= 9999999999 {
		m.CoverID = &d.CoverID
	}
	if editionID.MatchString(d.EditionKey) {
		m.EditionID = &d.EditionKey
	}
	return m
}

func searchOpenLibrary(ctx context.Context, client matcherquota.Doer, endpoint string, params url.Values) ([]openLibrarySearchDoc, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+params.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "AnthoLume (https://github.com/evanreichard/AnthoLume)")
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, openLibraryStatusError(res.StatusCode)
	}
	const max = 512 << 10
	raw, err := io.ReadAll(io.LimitReader(res.Body, max+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > max {
		return nil, fmt.Errorf("Open Library response exceeded limit")
	}
	var payload struct {
		Docs []openLibrarySearchDoc `json:"docs"`
	}
	if err = json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if payload.Docs == nil {
		return nil, fmt.Errorf("Open Library response omitted results")
	}
	return payload.Docs, nil
}

func openLibraryStatusError(status int) error {
	if status == http.StatusTooManyRequests {
		return fmt.Errorf("Open Library returned HTTP %d: %w", status, matcherquota.ErrLimited)
	}
	return fmt.Errorf("Open Library returned HTTP %d", status)
}

func lookupText(value string, limit int) string {
	r := []rune(strings.TrimSpace(value))
	return string(r[:min(len(r), limit)])
}
