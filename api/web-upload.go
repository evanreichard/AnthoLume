package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"reichard.io/antholume/metadata"
	"reichard.io/antholume/reading"
)

func documentUploadStatus(err error) int {
	switch {
	case errors.Is(err, metadata.ErrUnsupportedFileType):
		return http.StatusUnsupportedMediaType
	case errors.Is(err, metadata.ErrArchiveTooLarge):
		return http.StatusRequestEntityTooLarge
	case errors.Is(err, metadata.ErrInvalidDocument):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func (s *webAPI) UploadDocument(ctx context.Context, r UploadDocumentRequestObject) (UploadDocumentResponseObject, error) {
	api := s.api
	ctx = requestContext(ctx)
	if api.cfg.DemoMode {
		return nil, &reading.Failure{Status: http.StatusForbidden, Code: "forbidden"}
	}
	select {
	case api.webUploadSlots <- struct{}{}:
		defer func() { <-api.webUploadSlots }()
	default:
		return nil, adminFailure(409, "server_busy")
	}
	stage, err := os.CreateTemp(api.cfg.ConfigPath, ".upload-*.epub")
	if err != nil {
		return nil, err
	}
	defer os.Remove(stage.Name())
	defer stage.Close()
	n, err := io.Copy(stage, io.LimitReader(contextReader{ctx, r.Body}, metadata.MaxDocumentSize+1))
	if err != nil {
		if requestReadTimedOut(err) {
			return nil, adminFailure(http.StatusRequestTimeout, "request_timeout")
		}
		return nil, err
	}
	if n > metadata.MaxDocumentSize {
		return nil, &reading.Failure{Status: http.StatusRequestEntityTooLarge, Code: "invalid_request"}
	}
	if n == 0 {
		return nil, &reading.Failure{Status: http.StatusBadRequest, Code: "invalid_request"}
	}
	info, err := metadata.GetOpenedMetadata(stage)
	if err != nil {
		status := documentUploadStatus(err)
		if status >= 500 {
			return nil, err
		}
		return nil, &reading.Failure{Status: status, Code: "invalid_request"}
	}
	if !api.libraryWrite.TryLock() {
		return nil, adminFailure(409, "server_busy")
	}
	defer api.libraryWrite.Unlock()
	root, err := api.storageRoot(ctx, libraryRoot)
	if err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(root.Path, "upload-*.epub")
	if err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		file.Close()
		if !committed {
			os.Remove(file.Name())
		}
	}()
	if _, err := io.Copy(file, contextReader{ctx, io.NewSectionReader(stage, 0, n)}); err != nil {
		return nil, err
	}
	if err := file.Sync(); err != nil {
		return nil, err
	}
	if err := file.Close(); err != nil {
		return nil, err
	}
	if err := syncAdminDirectory(root.Path); err != nil {
		return nil, err
	}
	committed, err = api.attachCatalogFile(ctx, libraryRoot, filepath.Base(file.Name()), info)
	if err != nil {
		return nil, err
	}
	doc, err := api.db.Queries.GetDocument(ctx, *info.PartialMD5)
	if err != nil {
		return nil, err
	}
	if doc.Deleted {
		return nil, &reading.Failure{Status: http.StatusConflict, Code: "conflict"}
	}
	out := api.documentDTOWith(ctx, api.db.DB, doc)
	if !out.FileAvailable {
		return nil, &reading.Failure{Status: http.StatusConflict, Code: "conflict"}
	}
	return UploadDocument200JSONResponse(out), nil
}
