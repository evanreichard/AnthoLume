package shelfmark

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const releaseSearchTimeout = 300 * time.Second

type Release struct {
	Key, Source                                    string
	SourceID                                       string `json:"-"`
	Title, Author, Format, Size, Language, Indexer string
	Selection                                      string `json:",omitempty"`
	payload                                        json.RawMessage
}

type ReleaseList struct {
	Book     Book
	Releases []Release
	Partial  bool
}

type verifiedRelease struct {
	release Release
	payload []byte
}

type upstreamRelease struct {
	Source      string          `json:"source"`
	SourceID    string          `json:"source_id"`
	Title       string          `json:"title"`
	Author      json.RawMessage `json:"author"`
	Format      string          `json:"format"`
	Language    string          `json:"language"`
	Size        string          `json:"size"`
	Indexer     string          `json:"indexer"`
	ContentType string          `json:"content_type"`
	Extra       struct {
		Author              json.RawMessage   `json:"author"`
		ContentType         string            `json:"content_type"`
		Format              string            `json:"format"`
		Formats             []string          `json:"formats"`
		FormatsDisplay      string            `json:"formats_display"`
		UnrecognizedFormats []string          `json:"unrecognized_formats"`
		Categories          []json.RawMessage `json:"categories"`
	} `json:"extra"`
}

var audioFormatHint = regexp.MustCompile(`(?i)\b(?:audiobooks?|m4b|mp3|m4a|mp4|flac|ogg|wma|aac|wav|opus)\b`)

var ErrFormatsUnavailable = errors.New("could not read Shelfmark's supported ebook formats")

func (c *Client) supportedFormats(ctx context.Context) (map[string]bool, error) {
	var config struct {
		Formats []string `json:"supported_formats"`
	}
	if err := c.get(ctx, "/api/config", nil, &config); err != nil || config.Formats == nil {
		return nil, ErrFormatsUnavailable
	}
	allowed := make(map[string]bool, len(config.Formats))
	for _, format := range config.Formats {
		allowed[strings.TrimPrefix(strings.ToLower(strings.TrimSpace(format)), ".")] = true
	}
	return allowed, nil
}

func (r upstreamRelease) ebookFormat(allowed map[string]bool) string {
	for _, kind := range []string{r.ContentType, r.Extra.ContentType} {
		// Source Labels - Some sources report “book” or a decorated catalog category instead of “ebook”.
		kind = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(kind), "📘"))
		switch strings.ToLower(kind) {
		case "", "ebook", "book", "books", "book (fiction)", "book (non-fiction)":
		default:
			return ""
		}
	}
	if audioFormatHint.MatchString(r.Title) || audioFormatHint.MatchString(r.Extra.FormatsDisplay) || len(r.Extra.UnrecognizedFormats) != 0 {
		return ""
	}
	for _, raw := range r.Extra.Categories {
		if n, err := strconv.Atoi(strings.Trim(string(raw), `"`)); err == nil && n >= 3030 && n <= 3049 {
			return ""
		}
	}
	formats := append([]string{r.Format, r.Extra.Format}, r.Extra.Formats...)
	var first string
	for _, format := range formats {
		format = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(format)), ".")
		switch format {
		case "":
		case "epub", "pdf", "mobi", "azw", "azw3", "fb2", "djvu", "cbz", "cbr", "txt", "rtf", "doc", "docx":
			if !allowed[format] {
				return ""
			}
			if first == "" {
				first = format
			}
		default:
			return ""
		}
	}
	return first
}

func verifyRelease(raw json.RawMessage, allowed map[string]bool) (verifiedRelease, bool) {
	var row upstreamRelease
	if json.Unmarshal(raw, &row) != nil || !segment.MatchString(row.Source) || strings.TrimSpace(row.SourceID) == "" || len(row.SourceID) > 4096 || strings.TrimSpace(row.Title) == "" {
		return verifiedRelease{}, false
	}
	format := row.ebookFormat(allowed)
	if format == "" {
		return verifiedRelease{}, false
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return verifiedRelease{}, false
	}
	// Keep Shelfmark's release fields, not action parameters such as priority or user overrides.
	payload := map[string]json.RawMessage{"content_type": json.RawMessage(`"ebook"`)}
	for _, key := range []string{"source", "source_id", "title", "format", "language", "size", "size_bytes", "download_url", "info_url", "protocol", "indexer", "seeders", "peers", "extra"} {
		if value, ok := fields[key]; ok {
			payload[key] = value
		}
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return verifiedRelease{}, false
	}
	var author string
	for _, raw := range []json.RawMessage{row.Author, row.Extra.Author} {
		var name string
		if json.Unmarshal(raw, &name) == nil && strings.TrimSpace(name) != "" {
			author = strings.TrimSpace(name)
			break
		}
	}
	key := sha256.Sum256([]byte(row.Source + "\x00" + row.SourceID))
	return verifiedRelease{release: Release{
		Key: hex.EncodeToString(key[:]), Source: row.Source, SourceID: row.SourceID,
		Title: row.Title, Author: author, Format: format, Size: row.Size, Language: row.Language, Indexer: row.Indexer,
	}, payload: body}, true
}

func (c *Client) Releases(ctx context.Context, provider, id string) (ReleaseList, error) {
	if !validBookKey(provider, id) {
		return ReleaseList{}, errors.New("invalid Shelfmark book identifier")
	}
	var result struct {
		Book     metadataBook      `json:"book"`
		Releases []json.RawMessage `json:"releases"`
		Errors   []json.RawMessage `json:"errors"`
	}
	allowed, err := c.supportedFormats(ctx)
	if err != nil {
		return ReleaseList{}, err
	}
	params := url.Values{"provider": {provider}, "book_id": {id}, "content_type": {"ebook"}}
	if err := c.get(ctx, "/api/releases", params, &result); err != nil {
		return ReleaseList{}, err
	}
	if result.Book.Provider != provider || result.Book.ID != id || strings.TrimSpace(result.Book.Title) == "" || result.Releases == nil {
		return ReleaseList{}, errors.New("invalid Shelfmark releases response")
	}
	out := ReleaseList{Book: c.normalize(result.Book), Releases: make([]Release, 0, len(result.Releases)), Partial: len(result.Errors) > 0}
	seen := make(map[string]bool)
	for _, raw := range result.Releases {
		item, ok := verifyRelease(raw, allowed)
		if !ok || seen[item.release.Key] {
			continue
		}
		selection, err := c.sealSelection(out.Book, item)
		if err != nil {
			out.Partial = true
			continue
		}
		seen[item.release.Key] = true
		item.release.Selection = selection
		out.Releases = append(out.Releases, item.release)
	}
	return out, nil
}

func (c *Client) Download(ctx context.Context, release Release) error {
	if len(release.payload) == 0 {
		return ErrInvalidSelection
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("%w: %w", ErrRejected, err)
	}
	res, err := c.do(ctx, http.MethodPost, c.endpoint("/api/releases/download", nil), release.payload, true)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var response struct {
		Status string `json:"status"`
		Error  string `json:"error"`
	}
	if err := decode(res.Body, &response); err == nil {
		switch res.StatusCode {
		case http.StatusOK:
			if response.Status == "queued" {
				return nil
			}
		case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden:
			if response.Error != "" {
				return fmt.Errorf("%w (HTTP %d)", ErrRejected, res.StatusCode)
			}
		case http.StatusInternalServerError:
			if response.Error == "Release is already in the download queue" {
				return ErrRejected
			}
		}
	}
	return fmt.Errorf("uncertain Shelfmark download outcome (HTTP %d)", res.StatusCode)
}
