package shelfmark

import (
	"bytes"
	"context"
	"crypto/cipher"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	// ErrRejected means Shelfmark confirmed it did not queue the release.
	ErrRejected = errors.New("Shelfmark refused the release")
	ErrNotFound = errors.New("Shelfmark book or cover not found")
	segment     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.~-]{0,127}$`)
)

const (
	maxBody  = 4 << 20
	maxImage = 8 << 20
)

type Client struct {
	base        *url.URL
	key         string
	http        *http.Client
	coverMu     sync.Mutex
	covers      map[[2]string]string
	coversUntil time.Time

	selectionCipher cipher.AEAD
}

type Book struct {
	Provider, ID, Title, Author, Description string
	Year                                     int
	HasCover                                 bool
}

type seriesMetadata struct {
	Name     json.RawMessage `json:"series_name"`
	Position json.RawMessage `json:"series_position"`
}

type metadataBook struct {
	seriesMetadata
	Provider    string   `json:"provider"`
	ID          string   `json:"provider_id"`
	Title       string   `json:"title"`
	Authors     []string `json:"authors"`
	Subtitle    string   `json:"subtitle"`
	Language    string   `json:"language"`
	ISBN10      string   `json:"isbn_10"`
	ISBN13      string   `json:"isbn_13"`
	Description string   `json:"description"`
	Year        int      `json:"publish_year"`
	CoverURL    string   `json:"cover_url"`
}

func New(baseURL, key string) (*Client, error) {
	u, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" || u.Opaque != "" {
		return nil, errors.New("invalid Shelfmark URL")
	}
	for _, part := range strings.Split(strings.Trim(u.Path, "/"), "/") {
		if part != "" && !segment.MatchString(part) {
			return nil, errors.New("invalid Shelfmark base path")
		}
	}
	key = strings.TrimSpace(key)
	if key == "" || strings.IndexFunc(key, func(r rune) bool { return r < 33 || r > 126 }) >= 0 {
		return nil, errors.New("invalid Shelfmark API key")
	}
	u.Path = strings.TrimRight(u.Path, "/")
	selectionCipher, err := newSelectionCipher(key)
	if err != nil {
		return nil, err
	}
	return &Client{base: u, key: key, selectionCipher: selectionCipher, http: &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func validBookKey(provider, id string) bool {
	return segment.MatchString(provider) && segment.MatchString(id)
}

func (c *Client) endpoint(path string, query url.Values) string {
	u := *c.base
	u.Path += path
	u.RawQuery = query.Encode()
	return u.String()
}

func (c *Client) do(ctx context.Context, method, endpoint string, body []byte, useKey bool) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, errors.New("invalid Shelfmark request")
	}
	if useKey {
		req.Header.Set("X-Api-Key", c.key)
		req.Header.Set("Accept", "application/json")
	} else {
		req.Header.Set("Accept", "image/jpeg, image/png, image/webp, image/gif")
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
		req.GetBody = nil
	}
	client := c.http
	if useKey && method == http.MethodGet && req.URL.Path == c.base.Path+"/api/releases" {
		searchClient := *client
		searchClient.Timeout = releaseSearchTimeout
		client = &searchClient
	}
	res, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, errors.New("Shelfmark HTTP request failed")
	}
	return res, nil
}

func readBounded(body io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, limit+1))
	if err != nil {
		return nil, errors.New("could not read Shelfmark response")
	}
	if int64(len(data)) > limit {
		return nil, errors.New("Shelfmark response exceeds size limit")
	}
	return data, nil
}

func decode(body io.Reader, out any) error {
	data, err := readBounded(body, maxBody)
	if err != nil {
		return err
	}
	if json.Unmarshal(data, out) != nil {
		return errors.New("invalid Shelfmark JSON response")
	}
	return nil
}

func (c *Client) get(ctx context.Context, path string, query url.Values, out any) error {
	res, err := c.do(ctx, http.MethodGet, c.endpoint(path, query), nil, true)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("Shelfmark returned HTTP %d", res.StatusCode)
	}
	return decode(res.Body, out)
}

func (c *Client) Search(ctx context.Context, query string) ([]Book, error) {
	query = strings.TrimSpace(query)
	if query == "" || len(query) > 512 {
		return nil, errors.New("invalid Shelfmark search query")
	}
	var result struct {
		Books []metadataBook `json:"books"`
	}
	if err := c.get(ctx, "/api/metadata/search", url.Values{"query": {query}}, &result); err != nil {
		return nil, err
	}
	if result.Books == nil {
		return nil, errors.New("Shelfmark search response has no books array")
	}
	// Reuse search artwork so rendering one results page doesn't require a metadata lookup per row.
	c.coverMu.Lock()
	defer c.coverMu.Unlock()
	if len(c.covers)+len(result.Books) > 512 || !time.Now().Before(c.coversUntil) {
		c.covers = make(map[[2]string]string)
		c.coversUntil = time.Now().Add(5 * time.Minute)
	}
	books := make([]Book, 0, len(result.Books))
	for _, book := range result.Books {
		if validBookKey(book.Provider, book.ID) && strings.TrimSpace(book.Title) != "" {
			books = append(books, c.normalize(book))
			if cover := c.coverURL(book); cover != "" && len(c.covers) < 512 {
				c.covers[[2]string{book.Provider, book.ID}] = cover
			}
		}
	}
	return books, nil
}

func (c *Client) detail(ctx context.Context, provider, id string) (metadataBook, error) {
	if !validBookKey(provider, id) {
		return metadataBook{}, errors.New("invalid Shelfmark book identifier")
	}
	var book metadataBook
	if err := c.get(ctx, "/api/metadata/book/"+provider+"/"+id, nil, &book); err != nil {
		return metadataBook{}, err
	}
	if book.Provider != provider || book.ID != id || strings.TrimSpace(book.Title) == "" {
		return metadataBook{}, errors.New("Shelfmark book response did not match the requested book")
	}
	return book, nil
}

func (c *Client) Book(ctx context.Context, provider, id string) (Book, error) {
	book, err := c.detail(ctx, provider, id)
	if err != nil {
		return Book{}, err
	}
	return c.normalize(book), nil
}

func (c *Client) normalize(book metadataBook) Book {
	return Book{Provider: book.Provider, ID: book.ID, Title: book.Title, Author: strings.Join(book.Authors, ", "), Description: book.Description, Year: book.Year, HasCover: c.coverURL(book) != ""}
}

func (c *Client) coverURL(book metadataBook) string {
	u, err := url.Parse(book.CoverURL)
	if err != nil || u.User != nil || u.Fragment != "" || u.Opaque != "" {
		return ""
	}
	if u.Host == "" && u.Scheme == "" {
		if u.EscapedPath() != c.base.Path+"/api/covers/"+book.Provider+"_"+book.ID {
			return ""
		}
		params, err := url.ParseQuery(u.RawQuery)
		if err != nil || len(params) != 1 || len(params["url"]) != 1 {
			return ""
		}
		// Decode Shelfmark's proxy URL rather than asking it to fetch an arbitrary destination.
		raw, err := base64.URLEncoding.DecodeString(params.Get("url"))
		if err != nil {
			return ""
		}
		u, err = url.Parse(string(raw))
		if err != nil || u.User != nil || u.Fragment != "" || u.Opaque != "" {
			return ""
		}
	}
	if u.Scheme != "https" || u.Path == "" {
		return ""
	}
	switch strings.ToLower(u.Host) {
	case "assets.hardcover.app", "covers.openlibrary.org":
		return u.String()
	default:
		return ""
	}
}

func (c *Client) Cover(ctx context.Context, provider, id string) ([]byte, string, error) {
	c.coverMu.Lock()
	cover := c.covers[[2]string{provider, id}]
	fresh := time.Now().Before(c.coversUntil)
	c.coverMu.Unlock()
	if cover == "" || !fresh {
		book, err := c.detail(ctx, provider, id)
		if err != nil {
			return nil, "", err
		}
		cover = c.coverURL(book)
	}
	if cover == "" {
		return nil, "", ErrNotFound
	}
	res, err := c.do(ctx, http.MethodGet, cover, nil, false)
	if err != nil {
		return nil, "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, "", ErrNotFound
	}
	data, err := readBounded(res.Body, maxImage)
	if err != nil {
		return nil, "", err
	}
	kind := http.DetectContentType(data)
	switch kind {
	case "image/jpeg", "image/png", "image/webp", "image/gif":
		return data, kind, nil
	default:
		return nil, "", ErrNotFound
	}
}
