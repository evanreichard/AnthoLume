package api

import (
	"context"
	"database/sql"
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
	id := *info.PartialMD5
	result, err := api.db.DB.ExecContext(ctx, `INSERT INTO documents(id,md5,filepath,title,author,description,words,storage_root_id) VALUES(?,?,?,?,?,?,?,'library') ON CONFLICT(id) DO NOTHING`, id, info.MD5, filepath.Base(file.Name()), info.Title, info.Author, info.Description, info.WordCount)
	if err != nil {
		return nil, err
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	committed = inserted == 1
	doc, err := api.db.Queries.GetDocument(ctx, id)
	if errors.Is(err, sql.ErrNoRows) || err == nil && doc.Deleted {
		return nil, &reading.Failure{Status: http.StatusConflict, Code: "conflict"}
	}
	if err != nil {
		return nil, err
	}
	return UploadDocument200JSONResponse(api.documentDTO(doc)), nil
}
