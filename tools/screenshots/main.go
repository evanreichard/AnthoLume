// Command screenshots runs the gallery capture against a fresh, private instance.
package main

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"syscall"

	"reichard.io/antholume/config"
	"reichard.io/antholume/server"
)

func run(ctx context.Context) error {
	dir, err := os.MkdirTemp("", "antholume-gallery-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	defer listener.Close()
	origin := "http://" + listener.Addr().String()
	cfg := &config.Config{Version: "gallery", ConfigPath: dir, DataPath: dir, DBType: "sqlite", DBName: "gallery", PublicOrigin: origin, RegistrationEnabled: true}
	cfg.EnsureDirectories()
	app, err := server.New(cfg, os.DirFS("."))
	if err != nil {
		return err
	}
	app.Start(listener)
	defer app.Stop()

	cmd := exec.CommandContext(ctx, "node", "web/screenshots/capture.mjs", origin, dir)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	return cmd.Run()
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
