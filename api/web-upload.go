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

func documentUploadError(err error) (int, string) {
	switch {
	case errors.Is(err, metadata.ErrUnsupportedFileType):
		return http.StatusUnsupportedMediaType, "Unsupported file type; upload an EPUB"
	case errors.Is(err, metadata.ErrArchiveTooLarge):
		return http.StatusRequestEntityTooLarge, "EPUB exceeds archive safety limits"
	case errors.Is(err, metadata.ErrInvalidDocument):
		return http.StatusBadRequest, "Invalid or damaged EPUB"
	default:
		return http.StatusInternalServerError, "Unable to acquire metadata"
	}
}

func (s *webAPI) UploadDocument(ctx context.Context, r UploadDocumentRequestObject) (UploadDocumentResponseObject, error) {
	api := s.api
	ctx = requestContext(ctx)
	if api.cfg.DemoMode {
		return nil, &reading.Failure{Status: http.StatusForbidden, Code: "forbidden"}
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
	n, err := io.Copy(file, io.LimitReader(r.Body, metadata.MaxDocumentSize+1))
	if err != nil {
		return nil, err
	}
	if n > metadata.MaxDocumentSize {
		return nil, &reading.Failure{Status: http.StatusRequestEntityTooLarge, Code: "invalid_request"}
	}
	if n == 0 {
		return nil, &reading.Failure{Status: http.StatusBadRequest, Code: "invalid_request"}
	}
	if err = file.Sync(); err != nil {
		return nil, err
	}
	if err = file.Close(); err != nil {
		return nil, err
	}
	info, err := metadata.GetMetadata(file.Name())
	if err != nil {
		status, _ := documentUploadError(err)
		if status >= 500 {
			return nil, err
		}
		return nil, &reading.Failure{Status: status, Code: "invalid_request"}
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
	if doc.Deleted || !committed && (doc.Md5 == nil || *doc.Md5 != *info.MD5) {
		return nil, &reading.Failure{Status: http.StatusConflict, Code: "conflict"}
	}
	out := api.documentDTOWith(ctx, api.db.DB, doc)
	if !out.FileAvailable {
		return nil, &reading.Failure{Status: http.StatusConflict, Code: "conflict"}
	}
	return UploadDocument200JSONResponse(out), nil
}
