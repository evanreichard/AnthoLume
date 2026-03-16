package v1

import (
	"context"
	"encoding/json"
	"net/http"

	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

var _ StrictServerInterface = (*Server)(nil)

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

		// Skip auth for login endpoint
		if operationID == "Login" {
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

		// Store auth in context for handlers to access
		ctx = context.WithValue(ctx, "auth", auth)

		return handler(ctx, w, r, request)
	}
}

