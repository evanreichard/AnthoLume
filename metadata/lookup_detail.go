package metadata

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"reichard.io/antholume/matcherquota"
)

var workID = regexp.MustCompile(`^OL[0-9]{1,15}W$`)
var editionID = regexp.MustCompile(`^OL[0-9]{1,15}M$`)
var openLibraryAuthorKey = regexp.MustCompile(`^/authors/OL[0-9]{1,15}A$`)
var ErrInvalidLookupMatch = errors.New("invalid metadata match")

func (OpenLibraryCatalog) Resolve(ctx context.Context, work, edition, isbn string) (LookupMatch, error) {
	return resolveOpenLibrary(ctx, openLibraryMatcherQuota.Client(lookupClient, 1), openLibraryBase, work, edition, isbn)
}

type openLibraryWork struct {
	Key         string
	Title       string
	Description json.RawMessage
	Covers      []int64
	Authors     json.RawMessage
}

func readOpenLibraryWork(ctx context.Context, client matcherquota.Doer, base, work string) (openLibraryWork, error) {
	var record openLibraryWork
	if !workID.MatchString(work) {
		return record, ErrInvalidLookupMatch
	}
	path := "/works/" + work
	if err := readLookupRecord(ctx, client, base, path+".json", &record); err != nil {
		return record, err
	}
	if record.Key != "" && record.Key != path {
		return record, ErrInvalidLookupMatch
	}
	record.Title = lookupText(record.Title, 512)
	if record.Title == "" {
		return record, errors.New("Open Library work omitted title")
	}
	return record, nil
}

// VerifyMatcherWork validates a link-only confirmation without fetching optional author records.
func (OpenLibraryCatalog) VerifyMatcherWork(ctx context.Context, work string) error {
	_, err := readOpenLibraryWork(ctx, openLibraryMatcherQuota.Client(lookupClient, 1), openLibraryBase, work)
	return err
}

func resolveOpenLibrary(ctx context.Context, client matcherquota.Doer, base, work, edition, isbn string) (LookupMatch, error) {
	out := LookupMatch{ID: work}
	if edition != "" && !editionID.MatchString(edition) || isbn != "" && !lookupISBN.MatchString(isbn) {
		return out, ErrInvalidLookupMatch
	}
	record, err := readOpenLibraryWork(ctx, client, base, work)
	if err != nil {
		return out, err
	}
	out.Title = record.Title
	var description string
	if json.Unmarshal(record.Description, &description) != nil {
		var text struct{ Value string }
		if json.Unmarshal(record.Description, &text) == nil {
			description = text.Value
		}
	}
	if value := lookupText(description, 16000); value != "" {
		out.Description = &value
	}
	if edition == "" && isbn == "" {
		out.CoverID = openLibraryCoverID(record.Covers)
	} else {
		ed, err := readOpenLibraryEdition(ctx, client, base, edition, isbn)
		if err != nil && !errors.Is(err, ErrInvalidLookupMatch) {
			return out, err
		}
		if err == nil && ed.supports(work, isbn) {
			out.EditionID = &ed.ID
			out.ISBN10, out.ISBN13 = editionISBN(ed.ISBN10, isbn, 10), editionISBN(ed.ISBN13, isbn, 13)
			if publisher := lookupText(strings.Join(ed.Publishers, ", "), 256); publisher != "" {
				out.Publisher = &publisher
			}
			if published := lookupText(ed.Published, 80); published != "" {
				out.Published = &published
			}
			out.CoverID = openLibraryCoverID(ed.Covers)
			if out.CoverID == nil {
				out.CoverID = openLibraryCoverID(record.Covers)
			}
		}
	}
	out.Author = resolveOpenLibraryAuthors(ctx, client, base, record.Authors)
	return out, ctx.Err()
}

func resolveOpenLibraryAuthors(ctx context.Context, client matcherquota.Doer, base string, raw json.RawMessage) string {
	var credits []struct{ Author struct{ Key string } }
	if json.Unmarshal(raw, &credits) != nil {
		return ""
	}
	const maxAuthors = 4
	keys := make([]string, 0, maxAuthors)
	seen := make(map[string]bool, maxAuthors)
	for _, credit := range credits {
		key := credit.Author.Key
		if !openLibraryAuthorKey.MatchString(key) {
			return ""
		}
		if !seen[key] {
			if len(keys) == maxAuthors {
				return ""
			}
			seen[key] = true
			keys = append(keys, key)
		}
	}

	if len(keys) == 0 {
		return ""
	}
	// Optional Author Data - Cap total I/O (including rate-limit waits) and never replace authors with a partial list.
	ctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	names := make([]string, 0, len(keys))
	for _, key := range keys {
		var record struct{ Key, Name string }
		if err := readLookupRecord(ctx, client, base, key+".json", &record); err != nil || record.Key != key {
			return ""
		}
		name := strings.TrimSpace(record.Name)
		if name == "" || strings.ContainsFunc(name, unicode.IsControl) {
			return ""
		}
		names = append(names, name)
	}
	name := strings.Join(names, ", ")
	if utf8.RuneCountInString(name) > 512 {
		return ""
	}
	return name
}

type openLibraryEdition struct {
	ID         string `json:"-"`
	Key        string
	Works      []struct{ Key string }
	Covers     []int64
	ISBN10     []string `json:"isbn_10"`
	ISBN13     []string `json:"isbn_13"`
	Publishers []string
	Published  string `json:"publish_date"`
}

func readOpenLibraryEdition(ctx context.Context, client matcherquota.Doer, base, edition, isbn string) (openLibraryEdition, error) {
	var ed openLibraryEdition
	path := "/books/" + edition + ".json"
	if isbn != "" {
		path = "/isbn/" + isbn + ".json"
	}
	if err := readLookupRecord(ctx, client, base, path, &ed); err != nil {
		return ed, err
	}
	ed.ID = strings.TrimPrefix(ed.Key, "/books/")
	if !editionID.MatchString(ed.ID) || isbn == "" && ed.ID != edition {
		return ed, ErrInvalidLookupMatch
	}
	return ed, nil
}

func (ed openLibraryEdition) supports(work, isbn string) bool {
	if isbn != "" {
		ten, thirteen := editionISBN(ed.ISBN10, isbn, 10), editionISBN(ed.ISBN13, isbn, 13)
		if (ten == nil || *ten != isbn) && (thirteen == nil || *thirteen != isbn) {
			return false
		}
	}
	for _, w := range ed.Works {
		if w.Key == "/works/"+work {
			return true
		}
	}
	return false
}

func editionISBN(values []string, isbn string, length int) *string {
	var first *string
	for _, value := range values {
		value = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(value), "-", ""))
		if len(value) != length || !lookupISBN.MatchString(value) {
			continue
		}
		if value == isbn {
			return &value
		}
		if first == nil {
			first = &value
		}
	}
	return first
}

func openLibraryCoverID(covers []int64) *int64 {
	for _, cover := range covers {
		if cover > 0 && cover <= 9999999999 {
			return &cover
		}
	}
	return nil
}

func readLookupRecord(ctx context.Context, client matcherquota.Doer, base, path string, out any) error {
	for attempt := 0; attempt < 2; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path, nil)
		if err != nil {
			return err
		}
		req.Header.Set("User-Agent", "AnthoLume (https://github.com/evanreichard/AnthoLume)")
		res, err := client.Do(req)
		if err != nil {
			return err
		}
		if attempt == 0 && strings.HasPrefix(path, "/isbn/") && res.StatusCode >= 300 && res.StatusCode < 400 {
			location, err := res.Location()
			res.Body.Close()
			origin, _ := url.Parse(base)
			if err != nil || location.Scheme != origin.Scheme || location.Host != origin.Host || location.User != nil {
				return errors.New("unexpected Open Library ISBN redirect")
			}
			id := strings.TrimSuffix(strings.TrimPrefix(location.Path, "/books/"), ".json")
			if !strings.HasPrefix(location.Path, "/books/") || !editionID.MatchString(id) {
				return errors.New("unexpected Open Library edition path")
			}
			path = "/books/" + id + ".json"
			continue
		}
		defer res.Body.Close()
		if res.StatusCode == http.StatusNotFound {
			return ErrInvalidLookupMatch
		}
		if res.StatusCode != http.StatusOK {
			return openLibraryStatusError(res.StatusCode)
		}
		const max = 512 << 10
		raw, err := io.ReadAll(io.LimitReader(res.Body, max+1))
		if err != nil {
			return err
		}
		if len(raw) > max {
			return errors.New("Open Library response exceeded limit")
		}
		return json.Unmarshal(raw, out)
	}
	return errors.New("Open Library redirect limit exceeded")
}
