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
)

type server struct {
	db   *database.DBManager
	api  *api.API
	done chan int
	wg   sync.WaitGroup
}

// Create new server
func New(c *config.Config, assets fs.FS) *server {
	db := database.NewMgr(c)
	api := api.NewApi(db, c, assets)

	return &server{
		db:   db,
		api:  api,
		done: make(chan int),
	}
}

// Start server
func (s *server) Start() {
	log.Info("Starting server...")
	s.wg.Add(2)

	go func() {
		defer s.wg.Done()

		err := s.api.Start()
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

	log.Info("Server started")
}

// Stop server
func (s *server) Stop() {
	log.Info("Stopping server...")

	if err := s.api.Stop(); err != nil {
		log.Error("HTTP server stop failed: ", err)
	}

	close(s.done)
	s.wg.Wait()

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
