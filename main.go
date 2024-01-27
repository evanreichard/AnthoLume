package main

import (
	"embed"
	"os"
	"os/signal"
	"syscall"

	log "github.com/sirupsen/logrus"
	"github.com/urfave/cli/v2"
	"reichard.io/antholume/server"
)

//go:embed templates/* assets/*
var assets embed.FS

func main() {
	app := &cli.App{
		Name:  "AnthoLume",
		Usage: "A self hosted e-book progress tracker.",
		Commands: []*cli.Command{
			{
				Name:    "serve",
				Aliases: []string{"s"},
				Usage:   "Start AnthoLume web server.",
				Action:  cmdServer,
			},
		},
	}
	err := app.Run(os.Args)
	if err != nil {
		log.Fatal(err)
	}
}

func cmdServer(ctx *cli.Context) error {
	log.Info("Starting AnthoLume Server")

	// Create Channel
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)

	// Start Server
	s := server.New(&assets)
	s.Start()

	// Wait & Close
	<-signals
	s.Stop()

	// Stop Server
	os.Exit(0)

	return nil
}
