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
	docDir := filepath.Join(c.DataPath, "documents")
	coversDir := filepath.Join(c.DataPath, "covers")
	os.Mkdir(docDir, os.ModePerm)
	os.Mkdir(coversDir, os.ModePerm)

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
			log.Error("Error Starting Server:", err)
		}
	}()

	go func() {
		defer wg.Done()
		defer ticker.Stop()

		s.RunScheduledTasks()

		for {
			select {
			case <-ticker.C:
				s.RunScheduledTasks()
			case <-done:
				log.Info("Stopping Task Runner...")
				return
			}
		}
	}()
}

func (s *Server) RunScheduledTasks() {
	start := time.Now()
	if err := s.API.DB.CacheTempTables(); err != nil {
		log.Warn("[RunScheduledTasks] Refreshing Temp Table Cache Failure:", err)
	}
	log.Debug("[RunScheduledTasks] Completed in: ", time.Since(start))
}

func (s *Server) StopServer(wg *sync.WaitGroup, done chan<- struct{}) {
	log.Info("Stopping HTTP Server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.httpServer.Shutdown(ctx); err != nil {
		log.Info("Shutting Error")
	}
	s.API.DB.Shutdown()

	close(done)
	wg.Wait()

	log.Info("Server Stopped")
}
