package api

import (
	"bytes"
	"context"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"net/http"
	"os"
	"path/filepath"

	"reichard.io/antholume/matcherquota"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/reading"
)

func (api *API) fetchMetadataCover(ctx context.Context, provider MetadataProvider, coverID int64) ([]byte, error) {
	catalog, err := api.catalogFor(provider)
	if err != nil {
		return nil, err
	}
	raw, err := catalog.Cover(ctx, coverID)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return raw, metadataCoverFailure(err)
}

func metadataCoverFailure(err error) error {
	if errors.Is(err, matcherquota.ErrLimited) {
		return &reading.Failure{Status: http.StatusTooManyRequests, Code: "rate_limited"}
	}
	return err
}

// Cover Ownership - The caller owns the staged basename after success and must remove it if the write rolls back.
func (api *API) stageMatcherCover(ctx context.Context, provider MetadataProvider, match metadata.LookupMatch) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if match.CoverID == nil {
		return "", nil
	}
	catalog, err := api.catalogFor(provider)
	if err != nil {
		return "", err
	}
	raw, err := catalog.CoverFromMatch(ctx, match)
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if errors.Is(err, metadata.ErrLookupCoverMissing) {
		return "", nil
	}
	if err != nil {
		var problem *reading.Failure
		if errors.As(metadataCoverFailure(err), &problem) {
			return "", problem
		}
		return "", &reading.Failure{Status: http.StatusServiceUnavailable, Code: "metadata_unavailable"}
	}

	if len(raw) == 0 || len(raw) > 2<<20 {
		return "", nil
	}
	dimensions, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil || dimensions.Width < 2 || dimensions.Height < 2 || dimensions.Width > 4096 || dimensions.Height > 4096 {
		return "", nil
	}
	var ext string
	switch format {
	case "jpeg":
		ext = ".jpg"
	case "png":
		ext = ".png"
	default:
		return "", nil
	}
	decoded, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil || decoded.Bounds().Dx() != dimensions.Width || decoded.Bounds().Dy() != dimensions.Height {
		return "", nil
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}

	file, err := os.CreateTemp(filepath.Join(api.cfg.DataPath, "covers"), "match-*"+ext)
	if err != nil {
		return "", err
	}
	staged := false
	defer func() {
		if !staged {
			_ = os.Remove(file.Name())
		}
	}()
	_, writeErr := file.Write(raw)
	if closeErr := file.Close(); writeErr != nil || closeErr != nil {
		return "", errors.Join(writeErr, closeErr)
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	staged = true
	return filepath.Base(file.Name()), nil
}
