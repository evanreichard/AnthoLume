package main

import (
	"embed"
	"io/fs"
	"os"
	"os/signal"
	"syscall"

	log "github.com/sirupsen/logrus"
	"github.com/urfave/cli/v2"
	"reichard.io/antholume/config"
	"reichard.io/antholume/server"
)

//go:embed templates/* assets/*
var embeddedAssets embed.FS

func main() {
	app := &cli.App{
		Name:                 "AnthoLume",
		Usage:                "A self hosted e-book progress tracker.",
		EnableBashCompletion: true,
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
	var assets fs.FS = embeddedAssets

	// Load config
	c := config.Load()
	if c.Version == "develop" {
		assets = os.DirFS("./")
	}

	log.Info("Starting AnthoLume Server")

	// Create notify channel
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)

	// Start server
	s := server.New(c, assets)
	s.Start()

	// Wait & close
	<-signals
	s.Stop()

	// Stop server
	os.Exit(0)

	return nil
}
