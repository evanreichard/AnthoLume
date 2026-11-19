package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"reichard.io/antholume/database"
	"reichard.io/antholume/reading"
)

type authData struct {
	UserName   string
	AccountID  string
	Generation string
	IsAdmin    bool
	AuthHash   string
	Timezone   *string
}
type authKOHeader struct {
	AuthUser string `header:"x-auth-user"`
	AuthKey  string `header:"x-auth-key"`
}

func (api *API) authKOMiddleware(c *gin.Context) {
	session := sessions.Default(c)
	_, userHeader := c.Request.Header[http.CanonicalHeaderKey("x-auth-user")]
	_, keyHeader := c.Request.Header[http.CanonicalHeaderKey("x-auth-key")]
	if !userHeader && !keyHeader {
		if auth, ok := api.getSession(c.Request.Context(), session); ok {
			c.Set("Authorization", auth)
			c.Header("Cache-Control", "private")
			c.Next()
			return
		}
	}
	var h authKOHeader
	if c.ShouldBindHeader(&h) != nil || h.AuthUser == "" || h.AuthKey == "" || strings.Contains(h.AuthUser, ":") {
		koSyncError(c, 2001)
		return
	}
	refund, allowed := api.attempts.reserve(c.ClientIP())
	if !allowed {
		koSyncOverload(c, http.StatusTooManyRequests)
		return
	}
	auth, err := api.authorizeCredentials(c.Request.Context(), h.AuthUser, h.AuthKey)
	if err != nil {
		refund()
		koSyncOperationError(c, err)
		return
	}
	if auth == nil {
		koSyncError(c, 2001)
		return
	}
	refund()
	// Session Isolation - Explicit reader credentials must not rotate a valid browser session or its CSRF token.
	if _, ok := api.getSession(c.Request.Context(), session); !ok {
		if err := api.setSession(c.Request.Context(), session, *auth); err != nil {
			koSyncOperationError(c, err)
			return
		}
	}
	c.Set("Authorization", *auth)
	c.Header("Cache-Control", "private")
	c.Next()
}
func (api *API) authOPDSMiddleware(c *gin.Context) {
	c.Header("WWW-Authenticate", `Basic realm="restricted", charset="UTF-8"`)
	user, password, ok := c.Request.BasicAuth()
	if !ok || user == "" || password == "" {
		apiErrorPage(c, 401, "Invalid Authorization Headers")
		return
	}
	refund, allowed := api.attempts.reserve(c.ClientIP())
	if !allowed {
		apiErrorPage(c, 429, "Too Many Requests")
		return
	}
	// OPDS Compatibility - Basic credentials historically hash raw bytes without the SSR form's trimming.
	hash := md5Password(password)
	auth, err := api.authorizeCredentials(c.Request.Context(), user, hash)
	if err != nil {
		refund()
		koOperationError(c, err)
		return
	}
	if auth == nil {
		apiErrorPage(c, 401, "Unauthorized")
		return
	}
	refund()
	c.Set("Authorization", *auth)
	c.Header("Cache-Control", "private")
	c.Next()
}
func (api *API) koAuthRegister(c *gin.Context) {
	if !api.cfg.RegistrationEnabled {
		koSyncError(c, 2005)
		return
	}
	if !api.attempts.allow(c.ClientIP()) {
		koSyncOverload(c, http.StatusTooManyRequests)
		return
	}
	var r requestUser
	if c.ShouldBindJSON(&r) != nil || strings.Contains(r.Username, ":") {
		koSyncError(c, 2003)
		return
	}
	if _, err := api.registerIdentity(c.Request.Context(), r.Username, r.Password); err != nil {
		var failure *reading.Failure
		if errors.As(err, &failure) && failure.Code == "user_conflict" {
			koSyncError(c, 2002)
			return
		}
		koSyncOperationError(c, err)
		return
	}
	koJSON(c, 201, gin.H{"username": r.Username})
}
func (api *API) getSession(ctx context.Context, session sessions.Session) (authData, bool) {
	auth, ok, _ := api.sessionIdentity(ctx, session)
	return auth, ok
}
func (api *API) sessionIdentity(ctx context.Context, session sessions.Session) (authData, bool, error) {
	user, uok := session.Get("authorizedUser").(string)
	expiry, eok := session.Get("expiresAt").(int64)
	hash, hok := session.Get("authHash").(string)
	generation, gok := session.Get("readingGeneration").(string)
	if !uok || !eok || !hok || !gok || expiry <= time.Now().Unix() {
		return authData{}, false, nil
	}
	current, err := api.db.Queries.GetSessionIdentity(ctx, database.GetSessionIdentityParams{
		Generation: generation, UserID: user, AuthHash: &hash,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return authData{}, false, nil
	}
	if err != nil {
		return authData{}, false, err
	}
	return authData{
		UserName: user, AuthHash: hash, Generation: generation,
		AccountID: current.AccountID, IsAdmin: current.Admin, Timezone: current.Timezone,
	}, true, nil
}
func (api *API) anonymousSession(session sessions.Session) error {
	token, err := randomCSRF()
	if err != nil {
		return err
	}
	session.Clear()
	session.Set("csrf", token)
	session.Set("anonymousExpiresAt", time.Now().Add(7*24*time.Hour).Unix())
	return session.Save()
}
func (api *API) setSession(ctx context.Context, session sessions.Session, auth authData) error {
	generation, err := api.db.Queries.GetReadingGeneration(ctx)
	if err != nil {
		return err
	}
	token, err := randomCSRF()
	if err != nil {
		return err
	}
	session.Clear()
	session.Set("authorizedUser", auth.UserName)
	session.Set("isAdmin", auth.IsAdmin)
	session.Set("expiresAt", time.Now().Add(7*24*time.Hour).Unix())
	session.Set("authHash", auth.AuthHash)
	session.Set("readingGeneration", generation)
	session.Set("csrf", token)
	return session.Save()
}
