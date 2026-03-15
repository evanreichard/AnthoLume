package v1

import (
	"net/http"

	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

type Server struct {
	mux *http.ServeMux
	db  *database.DBManager
	cfg *config.Config
}

// NewServer creates a new native HTTP server
func NewServer(db *database.DBManager, cfg *config.Config) *Server {
	s := &Server{
		mux: http.NewServeMux(),
		db:  db,
		cfg: cfg,
	}
	s.registerRoutes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

// registerRoutes sets up all API routes
func (s *Server) registerRoutes() {
	// Documents endpoints
	s.mux.HandleFunc("/api/v1/documents", s.withAuth(wrapRequest(s.GetDocuments, parseDocumentListRequest)))
	s.mux.HandleFunc("/api/v1/documents/", s.withAuth(wrapRequest(s.GetDocument, parseDocumentRequest)))

	// Progress endpoints
	s.mux.HandleFunc("/api/v1/progress/", s.withAuth(wrapRequest(s.GetProgress, parseProgressRequest)))

	// Activity endpoints
	s.mux.HandleFunc("/api/v1/activity", s.withAuth(wrapRequest(s.GetActivity, parseActivityRequest)))

	// Settings endpoints
	s.mux.HandleFunc("/api/v1/settings", s.withAuth(wrapRequest(s.GetSettings, parseSettingsRequest)))

	// Auth endpoints
	s.mux.HandleFunc("/api/v1/auth/login", s.apiLogin)
	s.mux.HandleFunc("/api/v1/auth/logout", s.withAuth(s.apiLogout))
	s.mux.HandleFunc("/api/v1/auth/me", s.withAuth(s.apiGetMe))
}
