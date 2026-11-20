package api

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	middleware "github.com/oapi-codegen/gin-middleware"
	"reichard.io/antholume/reading"
)

// Opaque IDs - Route on escaped paths, then decode exactly once without treating a literal plus as a query-space.
func decodePathParameters(c *gin.Context) {
	if c.Request.URL.RawPath != "" {
		for i := range c.Params {
			decoded, err := url.PathUnescape(c.Params[i].Value)
			if err != nil {
				abortProblem(c, 400, "invalid_request")
				return
			}
			c.Params[i].Value = decoded
		}
	}
	c.Next()
}

type webPrincipalKey struct{}
type webFailure struct {
	status          int
	code            string
	revision        *string
	backupPathIssue *AdminBackupPathIssue
}

func (e *webFailure) Error() string { return e.code }
func problem(status int, code string) Problem {
	return Problem{Type: "urn:antholume:problem:" + code, Title: http.StatusText(status), Status: status, Code: code, Detail: "The request could not be completed."}
}
func abortProblem(c *gin.Context, status int, code string) {
	abortWithProblem(c, problem(status, code))
}
func abortWithProblem(c *gin.Context, p Problem) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Type", "application/problem+json")
	setRetryAfter(c.Writer, p.Status)
	c.AbortWithStatusJSON(p.Status, p)
}
func handleWebError(c *gin.Context, err error) {
	status, code := 500, "storage_error"
	var failure *reading.Failure
	var wf *webFailure
	if errors.As(err, &failure) {
		status, code = failure.Status, failure.Code
	}
	if errors.As(err, &wf) {
		status, code = wf.status, wf.code
	}
	type sqliteCode interface{ Code() int }
	var sq sqliteCode
	if errors.As(err, &sq) && (sq.Code()&255 == 5 || sq.Code()&255 == 6) {
		status, code = 503, "storage_error"
	}
	p := problem(status, code)
	if wf != nil && wf.backupPathIssue != nil {
		p.BackupPathIssue = wf.backupPathIssue
		p.Detail = "A catalog file reference must be repaired before this backup can be restored."
	}
	abortWithProblem(c, p)
}
func requestContext(ctx context.Context) context.Context {
	if c, ok := ctx.(*gin.Context); ok {
		return c.Request.Context()
	}
	return ctx
}
func webUser(ctx context.Context) authData {
	return requestContext(ctx).Value(webPrincipalKey{}).(authData)
}
func ginContext(ctx context.Context) *gin.Context { return ctx.(*gin.Context) }

type decodedParameterRouter struct{ routers.Router }

func (r decodedParameterRouter) FindRoute(request *http.Request) (*routers.Route, map[string]string, error) {
	route, params, err := r.Router.FindRoute(request)
	if err != nil {
		return nil, nil, err
	}
	// Parameter Length - Kin's encoded-path router returns escaped values; schema bounds apply to decoded characters, not percent-encoding bytes.
	for key, value := range params {
		decoded, err := url.PathUnescape(value)
		if err != nil {
			return nil, nil, err
		}
		params[key] = decoded
	}
	return route, params, nil
}
func (api *API) registerV1(router *gin.Engine) error {
	spec, err := loadOpenAPISpec()
	if err != nil {
		return err
	}
	spec.Servers = nil
	if err = spec.Validate(context.Background()); err != nil {
		return err
	}
	matched, err := gorillamux.NewRouter(spec)
	if err != nil {
		return err
	}
	options := &middleware.Options{Options: openapi3filter.Options{AuthenticationFunc: func(ctx context.Context, _ *openapi3filter.AuthenticationInput) error {
		c := middleware.GetGinContext(ctx)
		if c == nil || c.Request.Context().Value(webPrincipalKey{}) == nil {
			return errInvalidSession
		}
		return nil
	}}}
	group := router.Group("")
	group.Use(api.webBoundary)
	group.Use(func(c *gin.Context) {
		validation := options
		if isDocumentUpload(c.Request) || isRestoreUpload(c.Request) {
			copy := *options
			copy.Options.ExcludeRequestBody = true
			validation = &copy
		}
		if err := middleware.ValidateRequestFromContext(c, decodedParameterRouter{matched}, validation); err != nil {
			abortProblem(c, 400, "invalid_request")
			return
		}
		c.Next()
	})
	strict := NewStrictHandlerWithOptions(&webAPI{api}, nil, StrictGinServerOptions{
		RequestErrorHandlerFunc: func(c *gin.Context, _ error) { abortProblem(c, 400, "invalid_request") },
		HandlerErrorFunc: func(c *gin.Context, err error) {
			var wf *webFailure
			if errors.As(err, &wf) && wf.revision != nil {
				p := problem(wf.status, wf.code)
				p.CurrentRevision = wf.revision
				c.Header("Content-Type", "application/problem+json")
				c.AbortWithStatusJSON(wf.status, p)
				return
			}
			handleWebError(c, err)
		},
		ResponseErrorHandlerFunc: func(c *gin.Context, _ error) {
			if !c.Writer.Written() {
				abortProblem(c, 500, "storage_error")
			}
		},
	})
	RegisterHandlersWithOptions(group, strict, GinServerOptions{ErrorHandler: func(c *gin.Context, _ error, _ int) { abortProblem(c, 400, "invalid_request") }})
	return nil
}
func isRestoreUpload(r *http.Request) bool {
	return r.Method == http.MethodPost && r.URL.Path == "/api/v1/admin/restore"
}

func isDocumentUpload(r *http.Request) bool {
	return r.Method == http.MethodPost && r.URL.Path == "/api/v1/documents"
}

func (api *API) webBoundary(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	path := c.Request.URL.Path
	public := path == "/api/v1/session" || path == "/api/v1/capabilities" || path == "/api/v1/session/login" || path == "/api/v1/session/register"
	session := sessions.Default(c)
	auth, ok, err := api.sessionIdentity(c.Request.Context(), session)
	if err != nil {
		handleWebError(c, err)
		return
	}
	if ids := c.Request.Header.Values("X-AnthoLume-Account"); len(ids) != 0 {
		if !ok {
			abortProblem(c, 401, "unauthenticated")
			return
		}
		if len(ids) != 1 || ids[0] != auth.AccountID {
			abortProblem(c, 401, "account_changed")
			return
		}
	}
	if ok {
		c.Set("Authorization", auth)
		ctx := context.WithValue(c.Request.Context(), webPrincipalKey{}, auth)
		c.Request = c.Request.WithContext(reading.WithAccountID(ctx, auth.AccountID))
	}
	if !public && !ok {
		abortProblem(c, 401, "unauthenticated")
		return
	}
	if generation := c.Request.Header.Values("X-AnthoLume-Reading-Generation"); len(generation) != 0 && (len(generation) != 1 || generation[0] != auth.Generation) {
		abortProblem(c, 409, "stale_reading_generation")
		return
	}
	if c.Request.Method == "GET" {
		c.Next()
		return
	}
	token, tok := session.Get("csrf").(string)
	expiry, anon := session.Get("anonymousExpiresAt").(int64)
	supplied := c.GetHeader("X-CSRF-Token")
	if len(c.Request.Header.Values("Origin")) != 1 || len(c.Request.Header.Values("X-CSRF-Token")) != 1 || !tok || token == "" || (!ok && (!anon || expiry <= time.Now().Unix())) || c.GetHeader("Origin") != api.cfg.PublicOrigin || subtle.ConstantTimeCompare([]byte(token), []byte(supplied)) != 1 {
		abortProblem(c, 403, "csrf_failed")
		return
	}
	if (path == "/api/v1/session/login" || path == "/api/v1/session/register") && !api.attempts.allow(c.ClientIP()) {
		abortProblem(c, 429, "rate_limited")
		return
	}
	if c.Request.Method == http.MethodDelete {
		if c.Request.ContentLength != 0 {
			abortProblem(c, 400, "invalid_request")
			return
		}
		c.Next()
		return
	}
	media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if isRestoreUpload(c.Request) {
		if err != nil || media != "application/octet-stream" {
			abortProblem(c, 415, "invalid_request")
			return
		}
		c.Next()
		return
	}
	if isDocumentUpload(c.Request) {
		if err != nil || media != "application/epub+zip" {
			abortProblem(c, 415, "invalid_request")
			return
		}
		c.Next()
		return
	}
	if err != nil || media != "application/json" {
		abortProblem(c, 415, "invalid_request")
		return
	}
	limit := int64(8192)
	if c.Request.Method == http.MethodPatch && strings.HasPrefix(path, "/api/v1/documents/") {
		limit = 3 << 20
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, limit))
	if err != nil {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			abortProblem(c, 413, "invalid_request")
		} else if requestReadTimedOut(err) {
			abortProblem(c, 408, "request_timeout")
		} else {
			abortProblem(c, 400, "invalid_request")
		}
		return
	}
	if !utf8.Valid(body) || !json.Valid(body) || uniqueJSON(body) != nil {
		abortProblem(c, 400, "invalid_request")
		return
	}
	// Retained Validation - Replace before validation; strict Gin consumes the retained validated value.
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	c.Next()
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
