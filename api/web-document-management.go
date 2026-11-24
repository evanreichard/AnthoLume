package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	"strings"

	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/reading"
)

func (s *webAPI) EditDocument(ctx context.Context, r EditDocumentRequestObject) (EditDocumentResponseObject, error) {
	api := s.api
	if api.cfg.DemoMode {
		return nil, &reading.Failure{Status: 403, Code: "forbidden"}
	}
	ctx = requestContext(ctx)
	b := r.Body
	remove := b.RemoveCover != nil && *b.RemoveCover
	invalid := &reading.Failure{Status: 400, Code: "invalid_request"}
	if b.Title != nil && strings.TrimSpace(*b.Title) == "" || remove && b.CoverBase64 != nil {
		return nil, invalid
	}
	var workID string
	if ref := b.Match; ref != nil {
		match, err := api.resolveMetadataMatch(ctx, *ref)
		if err != nil {
			return nil, err
		}
		if ref.EditionId != nil && matchParam(match.EditionID) != *ref.EditionId ||
			ref.Isbn != nil && *ref.Isbn != matchParam(match.ISBN10) && *ref.Isbn != matchParam(match.ISBN13) {
			return nil, invalid
		}
		workID = match.ID
	}
	if !api.libraryWrite.TryLock() {
		return nil, adminFailure(409, "server_busy")
	}
	defer api.libraryWrite.Unlock()
	var cover *string
	var staged string
	committed := false
	defer func() {
		if staged != "" && !committed {
			_ = os.Remove(staged)
		}
	}()
	if remove {
		name := "UNKNOWN"
		cover = &name
	}
	if b.CoverBase64 != nil {
		raw, err := base64.StdEncoding.Strict().DecodeString(*b.CoverBase64)
		if err != nil || len(raw) > 2<<20 {
			return nil, invalid
		}
		dimensions, kind, err := image.DecodeConfig(bytes.NewReader(raw))
		if err != nil || dimensions.Width < 1 || dimensions.Height < 1 || dimensions.Width > 4096 || dimensions.Height > 4096 {
			return nil, invalid
		}
		ext := ".png"
		if kind == "jpeg" {
			ext = ".jpg"
		} else if kind != "png" {
			return nil, invalid
		}
		if _, _, err = image.Decode(bytes.NewReader(raw)); err != nil {
			return nil, invalid
		}
		file, err := os.CreateTemp(filepath.Join(api.cfg.DataPath, "covers"), "edit-*"+ext)
		if err != nil {
			return nil, err
		}
		staged = file.Name()
		_, err = file.Write(raw)
		closeErr := file.Close()
		if err != nil {
			return nil, err
		}
		if closeErr != nil {
			return nil, closeErr
		}
		name := filepath.Base(staged)
		cover = &name
	}
	tx, err := api.db.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	queries := database.New(tx)
	if b.Match != nil {
		if err := api.checkMetadataProvider(ctx, queries, b.Match.Provider); err != nil {
			return nil, err
		}
	}
	if b.Title != nil || b.Author != nil || b.Description != nil || b.Isbn10 != nil || b.Isbn13 != nil || cover != nil {
		if _, err := queries.UpdateWebDocumentMetadata(ctx, database.UpdateWebDocumentMetadataParams{
			ID: r.Id, Title: trimOptional(b.Title), Author: trimOptional(b.Author),
			Description: trimOptional(b.Description), Isbn10: b.Isbn10, Isbn13: b.Isbn13, Coverfile: cover,
		}); err != nil {
			return nil, err
		}
	}
	doc, err := queries.GetDocument(ctx, r.Id)
	if errors.Is(err, sql.ErrNoRows) || err == nil && doc.Deleted {
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	if err != nil {
		return nil, err
	}
	if b.Match != nil {
		namespace := workNamespaces[b.Match.Provider]
		if err := queries.RemoveOtherDocumentIdentifiers(ctx, database.RemoveOtherDocumentIdentifiersParams{DocumentID: r.Id, Namespace: namespace, Value: workID}); err != nil {
			return nil, err
		}
		if err := queries.LinkDocumentIdentifier(ctx, database.LinkDocumentIdentifierParams{DocumentID: r.Id, Namespace: namespace, Value: workID}); err != nil {
			return nil, err
		}
	}
	matches, err := documentMatches(ctx, queries, r.Id)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	committed = true
	result := api.documentDTO(doc)
	result.Matches = matches
	return EditDocument200JSONResponse(result), nil
}

func trimOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}

func (s *webAPI) DeleteDocument(ctx context.Context, r DeleteDocumentRequestObject) (DeleteDocumentResponseObject, error) {
	if s.api.cfg.DemoMode {
		return nil, &reading.Failure{Status: 403, Code: "forbidden"}
	}
	n, err := s.api.db.Queries.DeleteDocument(requestContext(ctx), r.Id)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	return DeleteDocument204Response{}, nil
}

func (s *webAPI) GetMetadataCover(ctx context.Context, r GetMetadataCoverRequestObject) (GetMetadataCoverResponseObject, error) {
	raw, err := metadata.LookupOpenLibraryCover(requestContext(ctx), r.CoverId, r.Params.PreferLarge != nil && *r.Params.PreferLarge)
	if errors.Is(err, metadata.ErrLookupCoverMissing) {
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	if err != nil {
		return nil, &reading.Failure{Status: 503, Code: "metadata_unavailable"}
	}
	setCoverResponseHeaders(ginContext(ctx).Writer)
	return GetMetadataCover200ImagejpegResponse{Body: bytes.NewReader(raw), ContentLength: int64(len(raw))}, nil
}
