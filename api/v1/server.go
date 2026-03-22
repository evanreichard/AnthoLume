package v1

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"

	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

var _ StrictServerInterface = (*Server)(nil)

type Server struct {
	mux    *http.ServeMux
	db     *database.DBManager
	cfg    *config.Config
	assets fs.FS
}

// NewServer creates a new native HTTP server
func NewServer(db *database.DBManager, cfg *config.Config, assets fs.FS) *Server {
	s := &Server{
		mux:    http.NewServeMux(),
		db:     db,
		cfg:    cfg,
		assets: assets,
	}

	// Create strict handler with authentication middleware
	strictHandler := NewStrictHandler(s, []StrictMiddlewareFunc{s.authMiddleware})

	s.mux = HandlerFromMuxWithBaseURL(strictHandler, s.mux, "/api/v1").(*http.ServeMux)
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

// authMiddleware adds authentication context to requests
func (s *Server) authMiddleware(handler StrictHandlerFunc, operationID string) StrictHandlerFunc {
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request any) (any, error) {
		// Store request and response in context for all handlers
		ctx = context.WithValue(ctx, "request", r)
		ctx = context.WithValue(ctx, "response", w)

		// Skip auth for login and info endpoints - cover and file require auth via cookies
		if operationID == "Login" || operationID == "GetInfo" {
			return handler(ctx, w, r, request)
		}

		auth, ok := s.getSession(r)
		if !ok {
			// Write 401 response directly
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(401)
			json.NewEncoder(w).Encode(ErrorResponse{Code: 401, Message: "Unauthorized"})
			return nil, nil
		}

		// Check admin status for admin-only endpoints
		adminEndpoints := []string{
			"GetAdmin",
			"PostAdminAction",
			"GetUsers",
			"UpdateUser",
			"GetImportDirectory",
			"PostImport",
			"GetImportResults",
			"GetLogs",
		}

		for _, adminEndpoint := range adminEndpoints {
			if operationID == adminEndpoint && !auth.IsAdmin {
				// Write 403 response directly
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(403)
				json.NewEncoder(w).Encode(ErrorResponse{Code: 403, Message: "Admin privileges required"})
				return nil, nil
			}
		}

		// Store auth in context for handlers to access
		ctx = context.WithValue(ctx, "auth", auth)

		return handler(ctx, w, r, request)
	}
}

// GetInfo returns server information
func (s *Server) GetInfo(ctx context.Context, request GetInfoRequestObject) (GetInfoResponseObject, error) {
	return GetInfo200JSONResponse{
		Version:              s.cfg.Version,
		SearchEnabled:        s.cfg.SearchEnabled,
		RegistrationEnabled:  s.cfg.RegistrationEnabled,
	}, nil
}


