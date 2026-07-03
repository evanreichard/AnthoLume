package server

import (
	"context"
	"io/fs"
	"net/http"
	"sync"
	"time"

	log "github.com/sirupsen/logrus"

	"reichard.io/antholume/api"
	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
	v1 "reichard.io/antholume/api/v1"
)

type server struct {
	db        *database.DBManager
	ginAPI    *api.API
	v1API     *v1.Server
	httpServer *http.Server
	done      chan int
	wg        sync.WaitGroup
}

// Create new server with both Gin and v1 API running in parallel
func New(c *config.Config, assets fs.FS) *server {
	db := database.NewMgr(c)
	ginAPI := api.NewApi(db, c, assets)
	v1API := v1.NewServer(db, c, assets)

	// Create combined mux that handles both Gin and v1 API
	mux := http.NewServeMux()

	// Register v1 API routes first (they take precedence)
	mux.Handle("/api/v1/", v1API)

	// Register Gin API routes (handles all other routes including /)
	// Gin's router implements http.Handler
	mux.Handle("/", ginAPI.Handler())

	// Create HTTP server with combined mux
	httpServer := &http.Server{
		Handler: mux,
		Addr:    ":" + c.ListenPort,
	}

	return &server{
		db:        db,
		ginAPI:    ginAPI,
		v1API:     v1API,
		httpServer: httpServer,
		done:      make(chan int),
	}
}

// Start server - runs both Gin and v1 API concurrently
func (s *server) Start() {
	log.Info("Starting server with both Gin (templates) and v1 (API)...")
	log.Info("v1 API endpoints available at /api/v1/*")
	log.Info("Gin template endpoints available at /")

	s.wg.Add(2)

	go func() {
		defer s.wg.Done()

		log.Infof("HTTP server listening on %s", s.httpServer.Addr)
		err := s.httpServer.ListenAndServe()
		if err != nil && err != http.ErrServerClosed {
			log.Error("Starting server failed: ", err)
		}
	}()

	go func() {
		defer s.wg.Done()

		ticker := time.NewTicker(15 * time.Minute)
		defer ticker.Stop()

		ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(5*time.Minute))
		for {
			select {
			case <-ticker.C:
				s.runScheduledTasks(ctx)
			case <-s.done:
				log.Info("Stopping task runner...")
				cancel()
				return
			}
		}
	}()

	log.Info("Server started - running both Gin and v1 API concurrently")
}

// Stop server - gracefully shuts down both APIs
func (s *server) Stop() {
	log.Info("Stopping server...")

	// Shutdown HTTP server (both Gin and v1)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.httpServer.Shutdown(ctx); err != nil {
		log.Error("HTTP server shutdown failed: ", err)
	}

	close(s.done)
	s.wg.Wait()

	// Close DB
	if err := s.db.DB.Close(); err != nil {
		log.Error("DB close failed: ", err)
	}

	log.Info("Server stopped")
}

// Run normal scheduled tasks
func (s *server) runScheduledTasks(ctx context.Context) {
	start := time.Now()
	if err := s.db.CacheTempTables(ctx); err != nil {
		log.Warn("Refreshing temp table cache failed: ", err)
	}
	log.Debug("Completed in: ", time.Since(start))
}