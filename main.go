package main

import (
	"os"
	"os/signal"

	log "github.com/sirupsen/logrus"
	"github.com/urfave/cli/v2"
	"reichard.io/bbank/server"
)

type UTCFormatter struct {
	log.Formatter
}

func (u UTCFormatter) Format(e *log.Entry) ([]byte, error) {
	e.Time = e.Time.UTC()
	return u.Formatter.Format(e)
}

func main() {
	log.SetFormatter(UTCFormatter{&log.TextFormatter{FullTimestamp: true}})

	app := &cli.App{
		Name:  "Book Bank",
		Usage: "A self hosted e-book progress tracker.",
		Commands: []*cli.Command{
			{
				Name:    "serve",
				Aliases: []string{"s"},
				Usage:   "Start Book Bank web server.",
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
	log.Info("Starting Book Bank Server")
	server := server.NewServer()
	server.StartServer()

	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt)
	<-c

	server.StopServer()
	os.Exit(0)

	return nil
}
