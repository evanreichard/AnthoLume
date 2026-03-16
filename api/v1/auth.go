package v1

import (
	"context"
	"crypto/md5"
	"fmt"
	"net/http"
	"time"

	argon2 "github.com/alexedwards/argon2id"
	"github.com/gorilla/sessions"
	log "github.com/sirupsen/logrus"
)

// POST /auth/login
func (s *Server) Login(ctx context.Context, request LoginRequestObject) (LoginResponseObject, error) {
	if request.Body == nil {
		return Login400JSONResponse{Code: 400, Message: "Invalid request body"}, nil
	}

	req := *request.Body
	if req.Username == "" || req.Password == "" {
		return Login400JSONResponse{Code: 400, Message: "Invalid credentials"}, nil
	}

	// MD5 - KOSync compatibility
	password := fmt.Sprintf("%x", md5.Sum([]byte(req.Password)))

	// Verify credentials
	user, err := s.db.Queries.GetUser(ctx, req.Username)
	if err != nil {
		return Login401JSONResponse{Code: 401, Message: "Invalid credentials"}, nil
	}

	if match, err := argon2.ComparePasswordAndHash(password, *user.Pass); err != nil || !match {
		return Login401JSONResponse{Code: 401, Message: "Invalid credentials"}, nil
	}

	// Get request and response from context (set by middleware)
	r := s.getRequestFromContext(ctx)
	w := s.getResponseWriterFromContext(ctx)

	if r == nil || w == nil {
		return Login500JSONResponse{Code: 500, Message: "Internal context error"}, nil
	}

	// Create session with cookie options for Vite proxy compatibility
	store := sessions.NewCookieStore([]byte(s.cfg.CookieAuthKey))
	if s.cfg.CookieEncKey != "" {
		if len(s.cfg.CookieEncKey) == 16 || len(s.cfg.CookieEncKey) == 32 {
			store = sessions.NewCookieStore([]byte(s.cfg.CookieAuthKey), []byte(s.cfg.CookieEncKey))
		}
	}

	session, _ := store.Get(r, "token")

	// Configure cookie options to work with Vite proxy
	// For localhost development, we need SameSite to allow cookies across ports
	session.Options.SameSite = http.SameSiteLaxMode
	session.Options.HttpOnly = true
	if !s.cfg.CookieSecure {
		session.Options.Secure = false // Allow HTTP for localhost development
	} else {
		session.Options.Secure = true
	}

	session.Values["authorizedUser"] = user.ID
	session.Values["isAdmin"] = user.Admin
	session.Values["expiresAt"] = time.Now().Unix() + (60 * 60 * 24 * 7)
	session.Values["authHash"] = *user.AuthHash

	if err := session.Save(r, w); err != nil {
		return Login500JSONResponse{Code: 500, Message: "Failed to create session"}, nil
	}

	return Login200JSONResponse{
		Username: user.ID,
		IsAdmin:  user.Admin,
	}, nil
}

// POST /auth/logout
func (s *Server) Logout(ctx context.Context, request LogoutRequestObject) (LogoutResponseObject, error) {
	_, ok := s.getSessionFromContext(ctx)
	if !ok {
		return Logout401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	r := s.getRequestFromContext(ctx)
	w := s.getResponseWriterFromContext(ctx)

	if r == nil || w == nil {
		return Logout401JSONResponse{Code: 401, Message: "Internal context error"}, nil
	}

	// Create session store
	store := sessions.NewCookieStore([]byte(s.cfg.CookieAuthKey))
	if s.cfg.CookieEncKey != "" {
		if len(s.cfg.CookieEncKey) == 16 || len(s.cfg.CookieEncKey) == 32 {
			store = sessions.NewCookieStore([]byte(s.cfg.CookieAuthKey), []byte(s.cfg.CookieEncKey))
		}
	}

	session, _ := store.Get(r, "token")

	// Configure cookie options (same as login)
	session.Options.SameSite = http.SameSiteLaxMode
	session.Options.HttpOnly = true
	if !s.cfg.CookieSecure {
		session.Options.Secure = false
	} else {
		session.Options.Secure = true
	}

	session.Values = make(map[any]any)

	if err := session.Save(r, w); err != nil {
		return Logout401JSONResponse{Code: 401, Message: "Failed to logout"}, nil
	}

	return Logout200Response{}, nil
}

// GET /auth/me
func (s *Server) GetMe(ctx context.Context, request GetMeRequestObject) (GetMeResponseObject, error) {
	auth, ok := s.getSessionFromContext(ctx)
	if !ok {
		return GetMe401JSONResponse{Code: 401, Message: "Unauthorized"}, nil
	}

	return GetMe200JSONResponse{
		Username: auth.UserName,
		IsAdmin:  auth.IsAdmin,
	}, nil
}

// getSessionFromContext extracts authData from context
func (s *Server) getSessionFromContext(ctx context.Context) (authData, bool) {
	auth, ok := ctx.Value("auth").(authData)
	if !ok {
		return authData{}, false
	}
	return auth, true
}

// getRequestFromContext extracts the HTTP request from context
func (s *Server) getRequestFromContext(ctx context.Context) *http.Request {
	r, ok := ctx.Value("request").(*http.Request)
	if !ok {
		return nil
	}
	return r
}

// getResponseWriterFromContext extracts the response writer from context
func (s *Server) getResponseWriterFromContext(ctx context.Context) http.ResponseWriter {
	w, ok := ctx.Value("response").(http.ResponseWriter)
	if !ok {
		return nil
	}
	return w
}

// getSession retrieves auth data from the session cookie
func (s *Server) getSession(r *http.Request) (auth authData, ok bool) {
	// Get session from cookie store
	store := sessions.NewCookieStore([]byte(s.cfg.CookieAuthKey))
	if s.cfg.CookieEncKey != "" {
		if len(s.cfg.CookieEncKey) == 16 || len(s.cfg.CookieEncKey) == 32 {
			store = sessions.NewCookieStore([]byte(s.cfg.CookieAuthKey), []byte(s.cfg.CookieEncKey))
		} else {
			log.Error("invalid cookie encryption key (must be 16 or 32 bytes)")
			return authData{}, false
		}
	}

	session, err := store.Get(r, "token")
	if err != nil {
		return authData{}, false
	}

	// Get session values
	authorizedUser := session.Values["authorizedUser"]
	isAdmin := session.Values["isAdmin"]
	expiresAt := session.Values["expiresAt"]
	authHash := session.Values["authHash"]

	if authorizedUser == nil || isAdmin == nil || expiresAt == nil || authHash == nil {
		return authData{}, false
	}

	auth = authData{
		UserName: authorizedUser.(string),
		IsAdmin:  isAdmin.(bool),
		AuthHash: authHash.(string),
	}

	// Validate auth hash
	ctx := r.Context()
	correctAuthHash, err := s.getUserAuthHash(ctx, auth.UserName)
	if err != nil || correctAuthHash != auth.AuthHash {
		return authData{}, false
	}

	return auth, true
}

// getUserAuthHash retrieves the user's auth hash from DB or cache
func (s *Server) getUserAuthHash(ctx context.Context, username string) (string, error) {
	user, err := s.db.Queries.GetUser(ctx, username)
	if err != nil {
		return "", err
	}
	return *user.AuthHash, nil
}

// authData represents authenticated user information
type authData struct {
	UserName string
	IsAdmin  bool
	AuthHash string
}
