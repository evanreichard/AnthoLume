package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gabriel-vasile/mimetype"
	"reichard.io/antholume/database"
	"reichard.io/antholume/reading"
)

// Cover Containment - Older cover records still resolve under the configured cover directory.
func containedFile(base string, name *string) (string, error) {
	if name == nil || *name == "" || filepath.IsAbs(*name) {
		return "", os.ErrNotExist
	}
	root, err := filepath.EvalSymlinks(base)
	if err != nil {
		return "", err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(filepath.Join(root, *name))
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", os.ErrNotExist
	}
	return resolved, nil
}
func (api *API) openDocument(ctx context.Context, d database.Document) (*os.File, error) {
	return api.openDocumentWith(ctx, api.db.DB, d)
}
func (api *API) openDocumentWith(ctx context.Context, q storageQuerier, d database.Document) (*os.File, error) {
	if d.Filepath == nil {
		return nil, os.ErrNotExist
	}
	id := libraryRoot
	if d.StorageRootID != nil {
		id = *d.StorageRootID
	}
	root, err := api.queryStorageRoot(ctx, q, id)
	if err != nil {
		return nil, err
	}
	return openStoredFile(root.Path, *d.Filepath)
}
func (api *API) coverPath(d database.Document) (string, error) {
	if d.Coverfile != nil && *d.Coverfile == "UNKNOWN" {
		return "", os.ErrNotExist
	}
	return containedFile(filepath.Join(api.cfg.DataPath, "covers"), d.Coverfile)
}
func fileMedia(name string) string {
	if strings.EqualFold(filepath.Ext(name), ".epub") {
		return "application/epub+zip"
	}
	media := mime.TypeByExtension(filepath.Ext(name))
	if media == "" {
		return "application/octet-stream"
	}
	return media
}
func (api *API) documentDTO(d database.Document) Document {
	return api.documentDTOWith(context.Background(), api.db.DB, d)
}
func (api *API) documentDTOWith(ctx context.Context, q storageQuerier, d database.Document) Document {
	out := Document{Id: d.ID, Title: d.Title, Author: d.Author, Series: d.Series, Description: d.Description, Lang: d.Lang, Isbn10: d.Isbn10, Isbn13: d.Isbn13}
	if file, err := api.openDocumentWith(ctx, q, d); err == nil {
		defer file.Close()
		if info, err := file.Stat(); err == nil && info.Mode().IsRegular() {
			out.FileAvailable = true
			size := info.Size()
			out.FileSizeBytes = &size
			media := fileMedia(*d.Filepath)
			out.MediaType = &media
		}
	}
	if path, err := api.coverPath(d); err == nil {
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			out.CoverAvailable = true
		}
	}
	return out
}

type fileResponse struct {
	file        *os.File
	request     *http.Request
	name, media string
	cover       bool
}

func (api *API) documentBinary(ctx context.Context, id string, cover bool) (*fileResponse, error) {
	d, err := api.db.Queries.GetDocument(requestContext(ctx), id)
	if errors.Is(err, sql.ErrNoRows) || err == nil && d.Deleted {
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	if err != nil {
		return nil, err
	}
	var path string
	var f *os.File
	if cover {
		path, err = api.coverPath(d)
		if err == nil {
			f, err = os.Open(path)
		}
	} else {
		f, err = api.openDocument(requestContext(ctx), d)
		if err == nil {
			path = *d.Filepath
		}
	}
	if err != nil {
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		return nil, &reading.Failure{Status: 404, Code: "not_found"}
	}
	media := fileMedia(path)
	if cover {
		detected, detectErr := mimetype.DetectReader(f)
		if detectErr != nil {
			f.Close()
			return nil, detectErr
		}
		media = detected.String()
		if _, err = f.Seek(0, 0); err != nil {
			f.Close()
			return nil, err
		}
		if !strings.HasPrefix(media, "image/") {
			f.Close()
			return nil, &reading.Failure{Status: 404, Code: "not_found"}
		}
	}
	return &fileResponse{file: f, request: ginContext(ctx).Request, name: filepath.Base(path), media: media, cover: cover}, nil
}
func (r *fileResponse) serve(w http.ResponseWriter) error {
	defer r.file.Close()
	info, err := r.file.Stat()
	if err != nil {
		return err
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", r.media)
	w.Header().Set("ETag", fmt.Sprintf(`W/"%x-%x"`, info.ModTime().UnixNano(), info.Size()))
	if r.cover {
		setCoverResponseHeaders(w)
	}
	if !r.cover {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": r.name}))
	}
	http.ServeContent(&fileErrorWriter{ResponseWriter: w}, r.request, r.name, info.ModTime(), r.file)
	return nil
}
func (r *fileResponse) VisitDownloadDocumentResponse(w http.ResponseWriter) error { return r.serve(w) }
func (r *fileResponse) VisitGetDocumentCoverResponse(w http.ResponseWriter) error { return r.serve(w) }

type fileErrorWriter struct {
	http.ResponseWriter
	failed bool
}

func (w *fileErrorWriter) WriteHeader(status int) {
	if status >= 400 {
		w.failed = true
		w.Header().Del("Content-Length")
		w.Header().Set("Content-Type", "application/problem+json")
		w.Header().Set("Cache-Control", "private, no-store")
		w.ResponseWriter.WriteHeader(status)
		_ = json.NewEncoder(w.ResponseWriter).Encode(problem(status, "invalid_request"))
		return
	}
	w.ResponseWriter.WriteHeader(status)
}
func (w *fileErrorWriter) Write(b []byte) (int, error) {
	if w.failed {
		return len(b), nil
	}
	return w.ResponseWriter.Write(b)
}
