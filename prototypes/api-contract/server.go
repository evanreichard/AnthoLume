package contract

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	middleware "github.com/oapi-codegen/gin-middleware"
	"reichard.io/antholume/database"
)

const JSONLimit = 8192
const FileLimit = 65536
const WireLimit = FileLimit + 4096
const proofOrigin = "https://proof.invalid"

type principalKey struct{}
type principal struct {
	user  string
	admin bool
}
type Server struct {
	store *Store
	epub  []byte
}

func abort(c *gin.Context, status int, code string) {
	c.Header("Content-Type", "application/problem+json")
	c.Header("Cache-Control", "private, no-store")
	c.AbortWithStatusJSON(status, problem(status, code))
}

func NewRouter(store *Store, cookies sessions.Store, epub []byte) (*gin.Engine, error) {
	spec, err := GetSwagger()
	if err != nil {
		return nil, err
	}
	if err = spec.Validate(context.Background()); err != nil {
		return nil, err
	}
	if len(epub) > FileLimit {
		return nil, errors.New("fixture exceeds file limit")
	}
	s := &Server{store, epub}
	r := gin.New()
	r.Use(sessions.Sessions("proof_session", cookies))
	r.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		session := sessions.Default(c)
		user, ok := session.Get("user").(string)
		if !ok {
			abort(c, 401, "unauthenticated")
			return
		}
		var admin bool
		err := store.DB.QueryRowContext(c.Request.Context(), "SELECT admin FROM users WHERE id=?", user).Scan(&admin)
		if errors.Is(err, sql.ErrNoRows) {
			abort(c, 401, "unauthenticated")
			return
		}
		if err != nil {
			abort(c, 500, "storage")
			return
		}
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), principalKey{}, principal{user, admin}))
		if strings.HasPrefix(c.Request.URL.Path, "/api/v1/admin/") && !admin {
			abort(c, 403, "forbidden")
			return
		}
		if c.Request.Method != "GET" && c.Request.Method != "HEAD" {
			token, ok := session.Get("csrf").(string)
			if !ok || token == "" || c.GetHeader("Origin") != proofOrigin || c.GetHeader("X-CSRF-Token") != token {
				abort(c, 403, "csrf")
				return
			}
			media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
			if err != nil {
				abort(c, 415, "media_type")
				return
			}
			isUpload := c.Request.URL.Path == "/api/v1/documents/upload"
			if (isUpload && media != "multipart/form-data") || (!isUpload && media != "application/json") {
				abort(c, 415, "media_type")
				return
			}
			limit := JSONLimit
			if isUpload {
				limit = WireLimit
			}
			body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, int64(limit)))
			if err != nil {
				var max *http.MaxBytesError
				if errors.As(err, &max) {
					abort(c, 413, "body_too_large")
				} else {
					abort(c, 400, "body_read")
				}
				return
			}
			if !isUpload && uniqueJSON(body) != nil {
				abort(c, 400, "validation")
				return
			}
			// Validation Handoff - Body replacement must precede validation; the strict binder consumes its retained validated value.
			c.Request.Body = io.NopCloser(bytes.NewReader(body))
		}
		c.Next()
	})
	r.Use(middleware.OapiRequestValidatorWithOptions(spec, &middleware.Options{
		ErrorHandler: func(c *gin.Context, _ string, status int) { abort(c, status, "validation") },
		Options: openapi3filter.Options{AuthenticationFunc: func(ctx context.Context, _ *openapi3filter.AuthenticationInput) error {
			c := middleware.GetGinContext(ctx)
			if c == nil {
				return errors.New("missing principal")
			}
			if _, ok := c.Request.Context().Value(principalKey{}).(principal); !ok {
				return errors.New("missing principal")
			}
			return nil
		}},
	}))
	strict := NewStrictHandlerWithOptions(s, nil, StrictGinServerOptions{
		RequestErrorHandlerFunc: func(c *gin.Context, _ error) { abort(c, 400, "validation") },
		HandlerErrorFunc:        func(c *gin.Context, _ error) { abort(c, 500, "storage") },
		ResponseErrorHandlerFunc: func(c *gin.Context, _ error) {
			if !c.Writer.Written() {
				abort(c, 500, "response")
			}
		},
	})
	RegisterHandlersWithOptions(r, strict, GinServerOptions{ErrorHandler: func(c *gin.Context, _ error, status int) {
		abort(c, status, "validation")
	}})
	r.NoRoute(func(c *gin.Context) { abort(c, 404, "not_found") })
	return r, nil
}

func uniqueJSON(body []byte) error {
	d := json.NewDecoder(bytes.NewReader(body))
	d.UseNumber()
	var value func() error
	value = func() error {
		token, err := d.Token()
		if err != nil {
			return err
		}
		delim, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				key, err := d.Token()
				if err != nil {
					return err
				}
				k, ok := key.(string)
				if !ok || seen[k] {
					return errors.New("duplicate key")
				}
				seen[k] = true
				if err = value(); err != nil {
					return err
				}
			}
		case '[':
			for d.More() {
				if err = value(); err != nil {
					return err
				}
			}
		default:
			return errors.New("unexpected delimiter")
		}
		_, err = d.Token()
		return err
	}
	if err := value(); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}

// Strict Context - Generated handlers pass pooled *gin.Context; SQLite cancellation watchers must retain the underlying request context instead.
func requestContext(ctx context.Context) context.Context {
	if c, ok := ctx.(*gin.Context); ok {
		return c.Request.Context()
	}
	return ctx
}
func who(ctx context.Context) principal { return ctx.Value(principalKey{}).(principal) }

func (s *Server) ListDocuments(ctx context.Context, request ListDocumentsRequestObject) (ListDocumentsResponseObject, error) {
	ctx = requestContext(ctx)
	page, size := 1, 9
	if request.Params.Page != nil {
		page = *request.Params.Page
	}
	if request.Params.PageSize != nil {
		size = *request.Params.PageSize
	}
	tx, err := s.store.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result := DocumentPage{Items: []Document{}, Page: page, PageSize: size}
	if err = tx.QueryRowContext(ctx, "SELECT count(*) FROM documents WHERE deleted=0").Scan(&result.Total); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT id FROM documents WHERE deleted=0 ORDER BY id LIMIT ? OFFSET ?", size, (page-1)*size)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		doc, err := database.New(tx).GetDocument(ctx, id)
		if err != nil {
			return nil, err
		}
		result.Items = append(result.Items, Document{Id: doc.ID, Title: doc.Title, Author: doc.Author})
	}
	if page*size < result.Total {
		next := page + 1
		result.NextPage = &next
	}
	return ListDocuments200JSONResponse(result), tx.Commit()
}
func (s *Server) AdminProbe(ctx context.Context, _ AdminProbeRequestObject) (AdminProbeResponseObject, error) {
	ctx = requestContext(ctx)
	if !who(ctx).admin {
		return AdminProbedefaultApplicationProblemPlusJSONResponse{StatusCode: 403, Body: problem(403, "forbidden")}, nil
	}
	return AdminProbe200JSONResponse{Ok: true}, nil
}
func (s *Server) SubmitProgress(ctx context.Context, r SubmitProgressRequestObject) (SubmitProgressResponseObject, error) {
	ctx = requestContext(ctx)
	out, err := s.store.Progress(ctx, who(ctx).user, *r.Body)
	if err != nil {
		return nil, err
	}
	if out.status == 200 {
		var receipt Receipt
		err = json.Unmarshal(out.body, &receipt)
		return SubmitProgress200JSONResponse(receipt), err
	}
	var p Problem
	err = json.Unmarshal(out.body, &p)
	return SubmitProgressdefaultApplicationProblemPlusJSONResponse{Body: p, StatusCode: out.status}, err
}
func (s *Server) SubmitActivity(ctx context.Context, r SubmitActivityRequestObject) (SubmitActivityResponseObject, error) {
	ctx = requestContext(ctx)
	out, err := s.store.Activity(ctx, who(ctx).user, *r.Body)
	if err != nil {
		return nil, err
	}
	if out.status == 200 {
		var receipt Receipt
		err = json.Unmarshal(out.body, &receipt)
		return SubmitActivity200JSONResponse(receipt), err
	}
	var p Problem
	err = json.Unmarshal(out.body, &p)
	return SubmitActivitydefaultApplicationProblemPlusJSONResponse{Body: p, StatusCode: out.status}, err
}
func (s *Server) DownloadDocument(ctx context.Context, r DownloadDocumentRequestObject) (DownloadDocumentResponseObject, error) {
	ctx = requestContext(ctx)
	var exists int
	if err := s.store.DB.QueryRowContext(ctx, "SELECT count(*) FROM documents WHERE id=? AND deleted=0", r.Id).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return DownloadDocumentdefaultApplicationProblemPlusJSONResponse{StatusCode: 404, Body: problem(404, "not_found")}, nil
	}
	disposition := "attachment; filename=\"synthetic.epub\""
	cache := "private, no-store"
	return DownloadDocument200ApplicationepubZipResponse{Body: bytes.NewReader(s.epub), ContentLength: int64(len(s.epub)), Headers: DownloadDocument200ResponseHeaders{ContentDisposition: &disposition, CacheControl: &cache}}, nil
}
func (s *Server) UploadDocument(_ context.Context, r UploadDocumentRequestObject) (UploadDocumentResponseObject, error) {
	fail := func(status int, code string) (UploadDocumentResponseObject, error) {
		return UploadDocumentdefaultApplicationProblemPlusJSONResponse{StatusCode: status, Body: problem(status, code)}, nil
	}
	p, err := r.Body.NextPart()
	if err != nil {
		return fail(400, "multipart")
	}
	if p.FormName() != "file" || p.FileName() == "" {
		return fail(400, "multipart")
	}
	if p.Header.Get("Content-Type") != "application/epub+zip" {
		return fail(415, "media_type")
	}
	b, err := io.ReadAll(io.LimitReader(p, FileLimit+1))
	if err != nil {
		return fail(400, "multipart")
	}
	if len(b) > FileLimit {
		return fail(413, "file_too_large")
	}
	if _, err = r.Body.NextPart(); err != io.EOF {
		return fail(400, "multipart")
	}
	z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil || len(z.File) == 0 || len(z.File) > 32 {
		return fail(400, "invalid_epub")
	}
	expanded := int64(0)
	found := false
	for _, f := range z.File {
		if strings.Contains(f.Name, "..") || strings.HasPrefix(f.Name, "/") || f.Mode()&0111 != 0 {
			return fail(400, "invalid_epub")
		}
		reader, err := f.Open()
		if err != nil {
			return fail(400, "invalid_epub")
		}
		data, err := io.ReadAll(io.LimitReader(reader, 128*1024-expanded+1))
		reader.Close()
		expanded += int64(len(data))
		if expanded > 128*1024 {
			return fail(413, "expanded_too_large")
		}
		if err != nil {
			return fail(400, "invalid_epub")
		}
		if f.Name == "mimetype" {
			found = string(data) == "application/epub+zip"
		}
	}
	if !found {
		return fail(400, "invalid_epub")
	}
	return UploadDocument200JSONResponse{Bytes: len(b), Disposition: ValidatedOnly}, nil
}
