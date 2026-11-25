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

	"reichard.io/antholume/matcherquota"
)

var workID = regexp.MustCompile(`^OL[0-9]{1,15}W$`)
var editionID = regexp.MustCompile(`^OL[0-9]{1,15}M$`)
var ErrInvalidLookupMatch = errors.New("invalid metadata match")

func (OpenLibraryCatalog) Resolve(ctx context.Context, work, edition, isbn string) (LookupMatch, error) {
	return resolveOpenLibrary(ctx, openLibraryMatcherQuota.Client(lookupClient, 1), openLibraryBase, work, edition, isbn)
}

func resolveOpenLibrary(ctx context.Context, client matcherquota.Doer, base, work, edition, isbn string) (LookupMatch, error) {
	out := LookupMatch{ID: work}
	if !workID.MatchString(work) || edition != "" && !editionID.MatchString(edition) || isbn != "" && !lookupISBN.MatchString(isbn) {
		return out, ErrInvalidLookupMatch
	}
	var record struct {
		Title       string
		Description json.RawMessage
		Covers      []int64
	}
	if err := readLookupRecord(ctx, client, base, "/works/"+work+".json", &record); err != nil {
		return out, err
	}
	out.Title = lookupText(record.Title, 512)
	if out.Title == "" {
		return out, errors.New("Open Library work omitted title")
	}
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
		return out, nil
	}
	ed, err := readOpenLibraryEdition(ctx, client, base, edition, isbn)
	if err != nil {
		if errors.Is(err, ErrInvalidLookupMatch) {
			return out, nil
		}
		return out, err
	}
	if !ed.supports(work, isbn) {
		return out, nil
	}
	out.EditionID = &ed.ID
	out.ISBN10, out.ISBN13 = editionISBN(ed.ISBN10, isbn, 10), editionISBN(ed.ISBN13, isbn, 13)
	if publisher := lookupText(strings.Join(ed.Publishers, ", "), 256); publisher != "" {
		out.Publisher = &publisher
	}
	if published := lookupText(ed.Published, 80); published != "" {
		out.Published = &published
	}
	out.CoverID = openLibraryCoverID(ed.Covers)
	return out, nil
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
