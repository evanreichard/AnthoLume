package server

import (
	"context"
	"io/fs"
	"net"
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
	wg        sync.WaitGroup
	workerCtx context.Context
	cancel    context.CancelFunc
	stop      sync.Once
}

// Create new server
func New(c *config.Config, assets fs.FS) (*server, error) {
	if err := c.ValidateConfigPath(); err != nil {
		return nil, err
	}
	db := database.NewMgr(c)
	app, err := api.NewAPI(db, c, assets)
	if err != nil {
		_ = db.DB.Close()
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	return &server{
		db:        db,
		api:       app,
		workerCtx: ctx,
		cancel:    cancel,
	}, nil
}

// Start server
func (s *server) Start(listener net.Listener) {
	log.Info("Starting server...")
	s.wg.Add(3)

	go func() {
		defer s.wg.Done()

		err := s.api.Serve(listener)
		if err != nil && err != http.ErrServerClosed {
			log.Error("Starting server failed: ", err)
		}
	}()

	go func() {
		defer s.wg.Done()

		runTaskRunner(s.workerCtx, 15*time.Minute, 5*time.Minute, s.runScheduledTasks)
	}()

	go func() {
		defer s.wg.Done()
		s.api.RunAutoImports(s.workerCtx)
	}()

	log.Info("Server started")
}

// Stop server
func (s *server) Stop() {
	log.Info("Stopping server...")

	s.stop.Do(func() {
		s.cancel()
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

func runTaskRunner(parent context.Context, interval, timeout time.Duration, run func(context.Context)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(parent, timeout)
			run(ctx)
			cancel()
		case <-parent.Done():
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
