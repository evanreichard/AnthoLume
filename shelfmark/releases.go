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
	"sort"
	"strings"
	"time"
)

const releaseSearchTimeout = 300 * time.Second

type Release struct {
	Key, Source                                    string
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
	info    json.RawMessage
}

type upstreamRelease struct {
	Source   string          `json:"source"`
	SourceID string          `json:"source_id"`
	Title    string          `json:"title"`
	Author   json.RawMessage `json:"author"`
	Format   string          `json:"format"`
	Language string          `json:"language"`
	Size     string          `json:"size"`
	Indexer  string          `json:"indexer"`
	Extra    struct {
		Author json.RawMessage `json:"author"`
		Info   json.RawMessage `json:"info"`
	} `json:"extra"`
}

func verifyRelease(raw json.RawMessage) (verifiedRelease, bool) {
	var row upstreamRelease
	if json.Unmarshal(raw, &row) != nil || !segment.MatchString(row.Source) || strings.TrimSpace(row.SourceID) == "" || len(row.SourceID) > 4096 || strings.TrimSpace(row.Title) == "" {
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
		Key: hex.EncodeToString(key[:]), Source: row.Source,
		Title: row.Title, Author: author, Format: row.Format, Size: row.Size, Language: row.Language, Indexer: row.Indexer,
	}, payload: body, info: row.Extra.Info}, true
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
	params := url.Values{"provider": {provider}, "book_id": {id}, "content_type": {"ebook"}}
	if err := c.get(ctx, "/api/releases", params, &result); err != nil {
		return ReleaseList{}, err
	}
	if result.Book.Provider != provider || result.Book.ID != id || strings.TrimSpace(result.Book.Title) == "" || result.Releases == nil {
		return ReleaseList{}, errors.New("invalid Shelfmark releases response")
	}
	out := ReleaseList{Book: c.normalize(result.Book), Releases: make([]Release, 0, len(result.Releases)), Partial: len(result.Errors) > 0}
	match := newReleaseMatcher(result.Book)
	scores := make(map[string]int)
	for _, raw := range result.Releases {
		item, ok := verifyRelease(raw)
		if _, seen := scores[item.release.Key]; !ok || seen {
			continue
		}
		selection, err := c.sealSelection(out.Book, item)
		if err != nil {
			out.Partial = true
			continue
		}
		scores[item.release.Key] = match.score(item)
		item.release.Selection = selection
		out.Releases = append(out.Releases, item.release)
	}
	sort.SliceStable(out.Releases, func(i, j int) bool {
		return scores[out.Releases[i].Key] > scores[out.Releases[j].Key]
	})
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
