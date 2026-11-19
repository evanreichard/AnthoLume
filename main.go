package main

import (
	"embed"
	"io/fs"
	"net"
	"os"
	"os/signal"
	"syscall"

	log "github.com/sirupsen/logrus"
	"github.com/urfave/cli/v2"
	"reichard.io/antholume/api"
	"reichard.io/antholume/config"
	"reichard.io/antholume/server"
)

//go:embed assets
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

	if err := c.ValidatePublicOrigin(); err != nil {
		return err
	}
	if c.Version != "develop" {
		if err := api.CheckAppAssets(assets); err != nil {
			return err
		}
	}
	log.Info("Starting AnthoLume Server")

	// Create notify channel
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)

	listener, err := net.Listen("tcp", net.JoinHostPort(c.ListenHost, c.ListenPort))
	if err != nil {
		return err
	}
	defer listener.Close()
	s := server.New(c, assets)
	s.Start(listener)

	// Wait & close
	<-signals
	s.Stop()

	return nil
}
