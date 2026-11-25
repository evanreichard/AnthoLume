package hardcover

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"reichard.io/antholume/matcherquota"
	"reichard.io/antholume/metadata"
)

const graphqlEndpoint = "https://api.hardcover.app/v1/graphql"

// Catalog reads public metadata with the server's API token, without a reader session or credential store.
type Catalog struct {
	token, endpoint string
	http            *http.Client
	assets          *http.Client
	quota           *matcherquota.Limiter
}

func NewCatalog(token string) *Catalog {
	return &Catalog{
		token: token, endpoint: graphqlEndpoint,
		quota: newCatalogQuota(),
		http: &http.Client{Timeout: requestLimit, CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}},
		assets: &http.Client{Timeout: requestLimit, CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}},
	}
}

func newCatalogQuota() *matcherquota.Limiter {
	return matcherquota.New(time.Second,
		matcherquota.Window{Duration: time.Minute, Units: 60},
		matcherquota.Window{Duration: 24 * time.Hour, Units: 5000},
	)
}

// Typesense Search - Hardcover's Book index searches title and contributor text together; its results scalar contains Typesense hits.
const catalogSearchArgs = `, query_type: "Book", fields: "title,author_names,alternative_titles", weights: "5,3,1", typos: "2,2,2", per_page: 8) { error results }`
const catalogSearch = `query AnthoLumeCatalogSearch($q: String!) {
  search(query: $q` + catalogSearchArgs + `
}`

const catalogBookFields = `id title description release_year image { id } contributions(where: {contribution: {_eq: "Author"}}, limit: 20) { author { name } }`
const catalogWork = `query AnthoLumeCatalogWork($work: Int!) {
  books(where: {id: {_eq: $work}}, limit: 1) { ` + catalogBookFields + ` }
}`

const catalogEditionFields = `id isbn_10 isbn_13 release_date image { id } publisher { name } book { ` + catalogBookFields + ` }`
const catalogEditions = `query AnthoLumeCatalogEditions($where: editions_bool_exp!) {
  editions(where: $where, order_by: {id: asc}, limit: 8) { ` + catalogEditionFields + ` }
}`

type catalogImage struct {
	ID int64 `json:"id"`
}

const maxCatalogImageID int64 = 9999999999

func (image catalogImage) cover(m *metadata.LookupMatch) {
	if image.ID > 0 && image.ID <= maxCatalogImageID {
		m.CoverID = &image.ID
	}
}

type catalogBook struct {
	Image         catalogImage `json:"image"`
	ID            int          `json:"id"`
	Title         string       `json:"title"`
	Description   string       `json:"description"`
	Year          *int         `json:"release_year"`
	Contributions []struct {
		Author struct{ Name string } `json:"author"`
	} `json:"contributions"`
}

type catalogEdition struct {
	Image     catalogImage          `json:"image"`
	ID        int                   `json:"id"`
	ISBN10    string                `json:"isbn_10"`
	ISBN13    string                `json:"isbn_13"`
	Published string                `json:"release_date"`
	Publisher struct{ Name string } `json:"publisher"`
	Book      catalogBook           `json:"book"`
}

var catalogISBN10 = regexp.MustCompile(`^[0-9]{9}[0-9X]$`)
var catalogISBN13 = regexp.MustCompile(`^[0-9]{13}$`)

func catalogISBNField(isbn string) string {
	switch {
	case catalogISBN10.MatchString(isbn):
		return "isbn_10"
	case catalogISBN13.MatchString(isbn):
		return "isbn_13"
	default:
		return ""
	}
}

func catalogID(value string) (int, bool) {
	id, err := strconv.ParseInt(value, 10, 32)
	return int(id), err == nil && id > 0 && strconv.FormatInt(id, 10) == value
}

func (c *Catalog) query(ctx context.Context, query string, vars any, result any) error {
	if !validToken(c.token) {
		return ErrProvider
	}
	if err := graphqlQuery(ctx, c.quota.Client(c.http, 1), c.endpoint, c.token, query, vars, result); err != nil {
		if errors.Is(err, matcherquota.ErrLimited) {
			return err
		}
		return ErrProvider
	}
	return nil
}

func (c *Catalog) Lookup(ctx context.Context, query string) ([]metadata.LookupMatch, error) {
	isbn := strings.Map(func(r rune) rune {
		if r == '-' || unicode.IsSpace(r) {
			return -1
		}
		return unicode.ToUpper(r)
	}, query)
	out := make([]metadata.LookupMatch, 0, 8)
	seen := make(map[string]bool)
	add := func(m metadata.LookupMatch) {
		if m.Title != "" && !seen[m.ID] && len(out) < 8 {
			out = append(out, m)
			seen[m.ID] = true
		}
	}
	if field := catalogISBNField(isbn); field != "" {
		editions, err := c.editions(ctx, map[string]any{field: catalogEqual(isbn)})
		if err != nil {
			return nil, err
		}
		for _, edition := range editions {
			if edition.ID > 0 && edition.Book.ID > 0 && edition.matchesISBN(isbn) {
				add(edition.match())
			}
		}
		return out, nil
	}

	var data struct {
		Search catalogSearchResult `json:"search"`
	}
	if err := c.query(ctx, catalogSearch, map[string]string{"q": query}, &data); err != nil {
		return nil, err
	}
	matches, err := data.Search.matches()
	if err != nil {
		return nil, err
	}
	for _, match := range matches {
		add(match)
	}
	return out, nil
}

type catalogSearchResult struct {
	Error   string `json:"error"`
	Results struct {
		Hits []struct {
			Document struct {
				ID      string       `json:"id"`
				Title   string       `json:"title"`
				Authors []string     `json:"author_names"`
				Year    *int         `json:"release_year"`
				Image   catalogImage `json:"image"`
			} `json:"document"`
		} `json:"hits"`
	} `json:"results"`
}

func (result catalogSearchResult) matches() ([]metadata.LookupMatch, error) {
	if result.Error != "" || result.Results.Hits == nil {
		return nil, ErrProvider
	}
	matches := make([]metadata.LookupMatch, 0, len(result.Results.Hits))
	for _, hit := range result.Results.Hits {
		doc := hit.Document
		if _, ok := catalogID(doc.ID); ok {
			m := metadata.LookupMatch{ID: doc.ID, Title: catalogText(doc.Title, 512), Author: catalogText(strings.Join(doc.Authors, ", "), 512), Year: doc.Year}
			doc.Image.cover(&m)
			matches = append(matches, m)
		}
	}
	return matches, nil
}

func (c *Catalog) Resolve(ctx context.Context, work, edition, isbn string) (metadata.LookupMatch, error) {
	workID, ok := catalogID(work)
	if !ok {
		return metadata.LookupMatch{}, metadata.ErrInvalidLookupMatch
	}
	if edition == "" && isbn == "" {
		var data struct {
			Books []catalogBook `json:"books"`
		}
		if err := c.query(ctx, catalogWork, map[string]int{"work": workID}, &data); err != nil {
			return metadata.LookupMatch{}, err
		}
		if data.Books == nil {
			return metadata.LookupMatch{}, ErrProvider
		}
		if len(data.Books) == 1 && data.Books[0].ID == workID {
			if m := data.Books[0].match(); m.Title != "" {
				return m, nil
			}
		}
	} else {
		where := map[string]any{"book_id": catalogEqual(workID)}
		var editionID int
		if edition != "" {
			editionID, ok = catalogID(edition)
			if !ok {
				return metadata.LookupMatch{}, metadata.ErrInvalidLookupMatch
			}
			where["id"] = catalogEqual(editionID)
		}
		if isbn != "" {
			field := catalogISBNField(isbn)
			if field == "" {
				return metadata.LookupMatch{}, metadata.ErrInvalidLookupMatch
			}
			where[field] = catalogEqual(isbn)
		}
		editions, err := c.editions(ctx, where)
		if err != nil {
			return metadata.LookupMatch{}, err
		}
		if len(editions) == 1 && editions[0].ID > 0 && (editionID == 0 || editions[0].ID == editionID) &&
			editions[0].Book.ID == workID && (isbn == "" || editions[0].matchesISBN(isbn)) {
			if m := editions[0].match(); m.Title != "" {
				return m, nil
			}
		}
	}
	return metadata.LookupMatch{}, metadata.ErrInvalidLookupMatch
}

func catalogEqual(value any) map[string]any { return map[string]any{"_eq": value} }

func (c *Catalog) editions(ctx context.Context, where map[string]any) ([]catalogEdition, error) {
	var data struct {
		Editions []catalogEdition `json:"editions"`
	}
	if err := c.query(ctx, catalogEditions, map[string]any{"where": where}, &data); err != nil {
		return nil, err
	}
	if data.Editions == nil {
		return nil, ErrProvider
	}
	return data.Editions, nil
}

func (e catalogEdition) matchesISBN(isbn string) bool {
	if len(isbn) == 10 {
		return e.ISBN10 == isbn
	}
	return e.ISBN13 == isbn
}

func (e catalogEdition) match() metadata.LookupMatch {
	m := e.Book.match()
	e.Image.cover(&m)
	id := strconv.Itoa(e.ID)
	m.EditionID = &id
	m.Publisher = catalogOptional(e.Publisher.Name, 512)
	m.Published = catalogOptional(e.Published, 64)
	if catalogISBN10.MatchString(e.ISBN10) {
		m.ISBN10 = &e.ISBN10
	}
	if catalogISBN13.MatchString(e.ISBN13) {
		m.ISBN13 = &e.ISBN13
	}
	return m
}

func (b catalogBook) match() metadata.LookupMatch {
	var names []string
	for _, contribution := range b.Contributions {
		if name := strings.TrimSpace(contribution.Author.Name); name != "" {
			names = append(names, name)
		}
	}
	m := metadata.LookupMatch{
		ID: strconv.Itoa(b.ID), Title: catalogText(b.Title, 512), Author: catalogText(strings.Join(names, ", "), 512),
		Description: catalogOptional(b.Description, 16000), Year: b.Year,
	}
	b.Image.cover(&m)
	return m
}

func catalogText(s string, limit int) string {
	runes := []rune(strings.TrimSpace(s))
	return string(runes[:min(len(runes), limit)])
}

func catalogOptional(s string, limit int) *string {
	if value := catalogText(s, limit); value != "" {
		return &value
	}
	return nil
}
