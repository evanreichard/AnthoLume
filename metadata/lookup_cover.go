package metadata

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image/jpeg"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"time"
)

var ErrLookupCoverMissing = errors.New("Open Library cover not found")

var archiveCoverHost = regexp.MustCompile(`^ia[0-9]+(?:\.us)?\.archive\.org$`)
var lookupCoverClient = &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error {
	if len(via) >= 4 || !allowedCoverURL(r.URL) {
		return http.ErrUseLastResponse
	}
	return nil
}}

func allowedCoverURL(u *url.URL) bool {
	host := u.Hostname()
	return u.Scheme == "https" && u.User == nil && u.Port() == "" && (host == "covers.openlibrary.org" || host == "archive.org" || archiveCoverHost.MatchString(host))
}

func LookupOpenLibraryCover(ctx context.Context, id int64, preferLarge bool) ([]byte, error) {
	return lookupOpenLibraryCover(ctx, lookupCoverClient, "https://covers.openlibrary.org", id, preferLarge)
}

func lookupOpenLibraryCover(ctx context.Context, client *http.Client, base string, id int64, preferLarge bool) ([]byte, error) {
	if id < 1 || id > 9999999999 {
		return nil, ErrLookupCoverMissing
	}
	fetch := func(size string) ([]byte, error) {
		return lookupCover(ctx, client, fmt.Sprintf("%s/b/id/%d-%s.jpg?default=false", base, id, size))
	}
	if preferLarge {
		if raw, err := fetch("L"); err == nil || ctx.Err() != nil {
			return raw, err
		}
	}
	return fetch("M")
}

func lookupCover(ctx context.Context, client *http.Client, endpoint string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return nil, ErrLookupCoverMissing
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Open Library cover returned HTTP %d", res.StatusCode)
	}
	const limit = 2 << 20
	raw, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > limit {
		return nil, errors.New("Open Library cover exceeded size limit")
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(raw))
	if err != nil || cfg.Width < 2 || cfg.Height < 2 || cfg.Width > 4096 || cfg.Height > 4096 {
		return nil, ErrLookupCoverMissing
	}
	return raw, nil
}
