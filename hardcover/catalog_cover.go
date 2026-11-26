package hardcover

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"strings"

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	"reichard.io/antholume/matcherquota"
	"reichard.io/antholume/metadata"
)

const catalogImageQuery = `query AnthoLumeCatalogImage($id: bigint!) {
  images(where: {id: {_eq: $id}}, limit: 1) { id url }
}`

const (
	maxCoverSource = 8 << 20
	maxCoverJPEG   = 2 << 20
	maxCoverSide   = 4096
)

func (c *Catalog) Cover(ctx context.Context, id int64) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if id < 1 || id > maxCatalogImageID {
		return nil, metadata.ErrLookupCoverMissing
	}
	var data struct {
		Images []catalogImage `json:"images"`
	}
	err := c.query(ctx, catalogImageQuery, map[string]any{"id": id}, &data)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, err
	}
	if data.Images == nil {
		return nil, ErrProvider
	}
	if len(data.Images) != 1 || data.Images[0].ID != id {
		return nil, metadata.ErrLookupCoverMissing
	}
	return c.downloadCover(ctx, data.Images[0].URL)
}

func (c *Catalog) CoverFromMatch(ctx context.Context, match metadata.LookupMatch) ([]byte, error) {
	if match.CoverID == nil {
		return nil, metadata.ErrLookupCoverMissing
	}
	return c.downloadCover(ctx, match.CoverURL)
}

func (c *Catalog) downloadCover(ctx context.Context, resolvedURL string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	u, err := url.Parse(resolvedURL)
	if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Host, "assets.hardcover.app") || u.User != nil || u.Fragment != "" {
		return nil, metadata.ErrLookupCoverMissing
	}

	// Use the asset-only client; neither redirects nor API credentials belong on this request.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, metadata.ErrLookupCoverMissing
	}
	req.Header.Set("User-Agent", hardcoverUserAgent)
	req.Header.Set("Accept", "image/jpeg, image/png, image/webp")
	res, err := c.assets.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrProvider
	}
	defer res.Body.Close()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	switch {
	case res.StatusCode == http.StatusTooManyRequests:
		return nil, errors.Join(ErrProvider, matcherquota.ErrLimited)
	case res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusGone || res.StatusCode >= 300 && res.StatusCode < 400:
		return nil, metadata.ErrLookupCoverMissing
	case res.StatusCode != http.StatusOK:
		return nil, ErrProvider
	}
	if res.ContentLength > maxCoverSource {
		return nil, metadata.ErrLookupCoverMissing
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxCoverSource+1))
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, ErrProvider
	}
	if len(raw) > maxCoverSource {
		return nil, metadata.ErrLookupCoverMissing
	}
	cover, err := coverJPEG(raw)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return cover, err
}

func coverJPEG(raw []byte) ([]byte, error) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || (format != "jpeg" && format != "png" && format != "webp") ||
		cfg.Width < 2 || cfg.Height < 2 || cfg.Width > maxCoverSide || cfg.Height > maxCoverSide {
		return nil, metadata.ErrLookupCoverMissing
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil || img.Bounds().Dx() != cfg.Width || img.Bounds().Dy() != cfg.Height {
		return nil, metadata.ErrLookupCoverMissing
	}
	if format == "jpeg" && len(raw) <= maxCoverJPEG {
		return raw, nil
	}
	for width, height := cfg.Width, cfg.Height; ; width, height = max(2, width/2), max(2, height/2) {
		out := image.NewRGBA(image.Rect(0, 0, width, height))
		draw.Draw(out, out.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
		if width == cfg.Width && height == cfg.Height {
			draw.Draw(out, out.Bounds(), img, img.Bounds().Min, draw.Over)
		} else {
			xdraw.BiLinear.Scale(out, out.Bounds(), img, img.Bounds(), draw.Over, nil)
		}
		var body bytes.Buffer
		if err := jpeg.Encode(&body, out, &jpeg.Options{Quality: 85}); err != nil {
			return nil, metadata.ErrLookupCoverMissing
		}
		if body.Len() <= maxCoverJPEG {
			return body.Bytes(), nil
		}
	}
}
