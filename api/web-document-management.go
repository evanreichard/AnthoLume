package api

import (
	"bytes"
	"context"
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
	if !api.libraryWrite.TryLock() {
		return nil, adminFailure(409, "server_busy")
	}
	defer api.libraryWrite.Unlock()
	ctx = requestContext(ctx)
	b := r.Body
	remove := b.RemoveCover != nil && *b.RemoveCover
	invalid := &reading.Failure{Status: 400, Code: "invalid_request"}
	if strings.TrimSpace(b.Title) == "" || remove && b.CoverBase64 != nil {
		return nil, invalid
	}
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
	result, err := tx.ExecContext(ctx, `UPDATE documents SET title=?, author=NULLIF(?,''), description=NULLIF(?,''), isbn10=NULLIF(?,''), isbn13=NULLIF(?,''), coverfile=COALESCE(?,coverfile) WHERE id=? AND deleted=0`, strings.TrimSpace(b.Title), strings.TrimSpace(b.Author), strings.TrimSpace(b.Description), b.Isbn10, b.Isbn13, cover, r.Id)
	if err != nil {
		return nil, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	doc, err := database.New(tx).GetDocument(ctx, r.Id)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	committed = true
	return EditDocument200JSONResponse(api.documentDTO(doc)), nil
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
	raw, err := metadata.LookupOpenLibraryCover(requestContext(ctx), r.CoverId)
	if errors.Is(err, metadata.ErrLookupCoverMissing) {
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	if err != nil {
		return nil, &reading.Failure{Status: 503, Code: "metadata_unavailable"}
	}
	setCoverResponseHeaders(ginContext(ctx).Writer)
	return GetMetadataCover200ImagejpegResponse{Body: bytes.NewReader(raw), ContentLength: int64(len(raw))}, nil
}

func (s *webAPI) LookupMetadata(ctx context.Context, r LookupMetadataRequestObject) (LookupMetadataResponseObject, error) {
	if s.api.cfg.DemoMode {
		return nil, &reading.Failure{Status: 403, Code: "forbidden"}
	}
	q := strings.TrimSpace(r.Params.Q)
	if len([]rune(q)) < 2 {
		return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
	}
	matches, err := metadata.LookupOpenLibrary(requestContext(ctx), q)
	if err != nil {
		return nil, &reading.Failure{Status: 503, Code: "metadata_unavailable"}
	}
	out := make([]MetadataMatch, 0, len(matches))
	for _, m := range matches {
		out = append(out, metadataMatch(m))
	}
	return LookupMetadata200JSONResponse(out), nil
}

func metadataMatch(m metadata.LookupMatch) MetadataMatch {
	return MetadataMatch{Id: m.ID, Title: m.Title, Author: m.Author, Year: m.Year, EditionId: m.EditionID, Publisher: m.Publisher, Published: m.Published, CoverId: m.CoverID, Description: m.Description, Isbn10: m.ISBN10, Isbn13: m.ISBN13}
}

func (s *webAPI) PreviewMetadataMatch(ctx context.Context, r PreviewMetadataMatchRequestObject) (PreviewMetadataMatchResponseObject, error) {
	if s.api.cfg.DemoMode {
		return nil, &reading.Failure{Status: 403, Code: "forbidden"}
	}
	value := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	m, err := metadata.ResolveOpenLibrary(requestContext(ctx), r.Params.WorkId, value(r.Params.EditionId), value(r.Params.Isbn))
	if errors.Is(err, metadata.ErrInvalidLookupMatch) {
		return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
	}
	if err != nil {
		return nil, &reading.Failure{Status: 503, Code: "metadata_unavailable"}
	}
	return PreviewMetadataMatch200JSONResponse(metadataMatch(m)), nil
}
