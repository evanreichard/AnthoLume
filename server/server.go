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
	db        *database.DBManager
	api       *api.API
	done      chan int
	wg        sync.WaitGroup
	workerCtx context.Context
	cancel    context.CancelFunc
	stop      sync.Once
}

// Create new server
func New(c *config.Config, assets fs.FS) *server {
	db := database.NewMgr(c)
	api := api.NewApi(db, c, assets)

	ctx, cancel := context.WithCancel(context.Background())
	return &server{
		db:        db,
		api:       api,
		done:      make(chan int),
		workerCtx: ctx,
		cancel:    cancel,
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

		s.runTaskRunner(15*time.Minute, 5*time.Minute)
	}()

	log.Info("Server started")
}

// Stop server
func (s *server) Stop() {
	log.Info("Stopping server...")

	s.stop.Do(func() {
		s.cancel()
		close(s.done)
		if err := s.api.Stop(); err != nil {
			log.Error("HTTP server stop failed: ", err)
		}
		s.wg.Wait()
		if err := s.db.DB.Close(); err != nil {
			log.Error("Database close failed: ", err)
		}
	})

	log.Info("Server stopped")
}

func (s *server) runTaskRunner(interval, timeout time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(s.workerCtx, timeout)
			s.runScheduledTasks(ctx)
			cancel()
		case <-s.done:
			return
		}
	}
}

// Run normal scheduled tasks
func (s *server) runScheduledTasks(ctx context.Context) {
	start := time.Now()
	if err := s.db.CacheTempTables(ctx); err != nil {
		log.Warn("Refreshing temp table cache failed: ", err)
	}
	log.Debug("Completed in: ", time.Since(start))
}
