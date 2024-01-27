package server

import (
	"context"
	"embed"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	log "github.com/sirupsen/logrus"

	"reichard.io/antholume/api"
	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

type Server struct {
	API        *api.API
	Config     *config.Config
	Database   *database.DBManager
	httpServer *http.Server
}

func NewServer(assets *embed.FS) *Server {
	c := config.Load()
	db := database.NewMgr(c)
	api := api.NewApi(db, c, assets)

	// Create Paths
	os.Mkdir(c.ConfigPath, 0755)
	os.Mkdir(c.DataPath, 0755)

	// Create Subpaths
	docDir := filepath.Join(c.DataPath, "documents")
	coversDir := filepath.Join(c.DataPath, "covers")
	backupDir := filepath.Join(c.DataPath, "backup")
	os.Mkdir(docDir, 0755)
	os.Mkdir(coversDir, 0755)
	os.Mkdir(backupDir, 0755)

	return &Server{
		API:      api,
		Config:   c,
		Database: db,
		httpServer: &http.Server{
			Handler: api.Router,
			Addr:    (":" + c.ListenPort),
		},
	}
}

func (s *Server) StartServer(wg *sync.WaitGroup, done <-chan struct{}) {
	ticker := time.NewTicker(15 * time.Minute)

	wg.Add(2)

	go func() {
		defer wg.Done()

		err := s.httpServer.ListenAndServe()
		if err != nil && err != http.ErrServerClosed {
			log.Error("Error starting server:", err)
		}
	}()

	go func() {
		defer wg.Done()
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				s.RunScheduledTasks()
			case <-done:
				log.Info("Stopping task runner...")
				return
			}
		}
	}()
}

func (s *Server) RunScheduledTasks() {
	start := time.Now()
	if err := s.API.DB.CacheTempTables(); err != nil {
		log.Warn("Refreshing temp table cache failure:", err)
	}
	log.Debug("Completed in: ", time.Since(start))
}

func (s *Server) StopServer(wg *sync.WaitGroup, done chan<- struct{}) {
	log.Info("Stopping HTTP server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.httpServer.Shutdown(ctx); err != nil {
		log.Info("HTTP server shutdown error: ", err)
	}
	s.API.DB.Shutdown()

	close(done)
	wg.Wait()

	log.Info("Server stopped")
}
