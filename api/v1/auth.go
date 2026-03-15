package v1

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	argon2 "github.com/alexedwards/argon2id"
	"github.com/gorilla/sessions"
	log "github.com/sirupsen/logrus"
)

// authData represents session authentication data
type authData struct {
	UserName string
	IsAdmin  bool
	AuthHash string
}

// withAuth wraps a handler with session authentication
func (s *Server) withAuth(handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth, ok := s.getSession(r)
		if !ok {
			writeJSONError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		ctx := context.WithValue(r.Context(), "auth", auth)
		handler(w, r.WithContext(ctx))
	}
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

// apiLogin handles POST /api/v1/auth/login
func (s *Server) apiLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid JSON")
		return
	}

	if req.Username == "" || req.Password == "" {
		writeJSONError(w, http.StatusBadRequest, "Invalid credentials")
		return
	}

	// MD5 - KOSync compatibility
	password := fmt.Sprintf("%x", md5.Sum([]byte(req.Password)))

	// Verify credentials
	user, err := s.db.Queries.GetUser(r.Context(), req.Username)
	if err != nil {
		writeJSONError(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}

	if match, err := argon2.ComparePasswordAndHash(password, *user.Pass); err != nil || !match {
		writeJSONError(w, http.StatusUnauthorized, "Invalid credentials")
		return
	}

	// Create session
	store := sessions.NewCookieStore([]byte(s.cfg.CookieAuthKey))
	if s.cfg.CookieEncKey != "" {
		if len(s.cfg.CookieEncKey) == 16 || len(s.cfg.CookieEncKey) == 32 {
			store = sessions.NewCookieStore([]byte(s.cfg.CookieAuthKey), []byte(s.cfg.CookieEncKey))
		}
	}

	session, _ := store.Get(r, "token")
	session.Values["authorizedUser"] = user.ID
	session.Values["isAdmin"] = user.Admin
	session.Values["expiresAt"] = time.Now().Unix() + (60 * 60 * 24 * 7)
	session.Values["authHash"] = *user.AuthHash

	if err := session.Save(r, w); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to create session")
		return
	}

	writeJSON(w, http.StatusOK, LoginResponse{
		Username: user.ID,
		IsAdmin:  user.Admin,
	})
}

// apiLogout handles POST /api/v1/auth/logout
func (s *Server) apiLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	store := sessions.NewCookieStore([]byte(s.cfg.CookieAuthKey))
	session, _ := store.Get(r, "token")
	session.Values = make(map[any]any)

	if err := session.Save(r, w); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "Failed to logout")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "logged out"})
}

// apiGetMe handles GET /api/v1/auth/me
func (s *Server) apiGetMe(w http.ResponseWriter, r *http.Request) {
	auth, ok := r.Context().Value("auth").(authData)
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	writeJSON(w, http.StatusOK, UserData{
		Username: auth.UserName,
		IsAdmin:  auth.IsAdmin,
	})
}

