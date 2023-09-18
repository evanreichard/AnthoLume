package server

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"time"

	log "github.com/sirupsen/logrus"

	"reichard.io/bbank/api"
	"reichard.io/bbank/config"
	"reichard.io/bbank/database"
)

type Server struct {
	API        *api.API
	Config     *config.Config
	Database   *database.DBManager
	httpServer *http.Server
}

func NewServer() *Server {
	c := config.Load()
	db := database.NewMgr(c)
	api := api.NewApi(db, c)

	// Create Paths
	docDir := filepath.Join(c.DataPath, "documents")
	coversDir := filepath.Join(c.DataPath, "covers")
	_ = os.Mkdir(docDir, os.ModePerm)
	_ = os.Mkdir(coversDir, os.ModePerm)

	return &Server{
		API:      api,
		Config:   c,
		Database: db,
	}
}

func (s *Server) StartServer() {
	listenAddr := (":" + s.Config.ListenPort)

	s.httpServer = &http.Server{
		Handler: s.API.Router,
		Addr:    listenAddr,
	}

	go func() {
		err := s.httpServer.ListenAndServe()
		if err != nil {
			log.Error("Error starting server ", err)
		}
	}()
}

func (s *Server) StopServer() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s.httpServer.Shutdown(ctx)
}
