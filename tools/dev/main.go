package main

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/alexedwards/argon2id"
	"reichard.io/antholume/api"
	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	args := os.Args[1:]
	if len(args) != 1 {
		log.Fatal("usage: dev-backend <loopback-port|clean>")
	}
	data, err := filepath.Abs("data")
	if err == nil {
		err = run(ctx, data, args[0], os.Getenv("RESTORE"), strings.TrimSpace(os.Getenv("RESET_USER")))
	}
	if err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, data, action, restore, resetUser string) error {
	if err := os.Mkdir(data, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	if info, err := os.Lstat(data); err != nil || !info.IsDir() {
		return fmt.Errorf("expected a local data directory at %s", data)
	}
	lock, err := os.OpenFile(filepath.Join(data, ".dev.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return errors.New("dev is running; stop it first")
		}
		return err
	}

	root := filepath.Join(data, "dev")
	rootInfo, err := os.Lstat(root)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if rootInfo != nil && !rootInfo.IsDir() {
		return fmt.Errorf("refusing to use %s: not a directory", root)
	}
	if action == "clean" {
		if err := os.RemoveAll(root); err != nil {
			return err
		}
		fmt.Println("Removed dev state:", root)
		return nil
	}

	dbPath := filepath.Join(root, "antholume.db")
	var input *os.File
	if restore != "" {
		if rootInfo != nil {
			return errors.New("dev state already exists; run make clean-dev before restoring")
		}
		input, err = os.Open(restore)
		if err != nil {
			return err
		}
		defer input.Close()
		if info, err := input.Stat(); err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return fmt.Errorf("expected a nonempty backup file at %s", restore)
		}
	} else if info, err := os.Lstat(dbPath); err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		return errors.New("no existing database at data/dev/antholume.db; run make dev RESTORE=/path/to/backup.zip (use make clean-dev first if the dev directory already exists)")
	}

	addr := net.JoinHostPort("127.0.0.1", action)
	ln, err := net.Listen("tcp4", addr)
	if err != nil {
		return err
	}
	defer ln.Close()
	if input != nil {
		if err := os.Mkdir(root, 0700); err != nil {
			return err
		}
	}
	initialized := input == nil
	defer func() {
		if !initialized {
			_ = os.RemoveAll(root)
		}
	}()

	for _, name := range []string{"CONFIG_PATH", "DATA_PATH"} {
		if err := os.Setenv(name, root); err != nil {
			return err
		}
	}
	cfg := config.Load()
	cfg.PublicOrigin, cfg.ListenPort = "http://"+addr, action
	cfg.DBType, cfg.DBName = "sqlite", "antholume"
	cfg.RegistrationEnabled, cfg.DemoMode = false, false
	cfg.CookieSecure, cfg.CookieHTTPOnly = false, true
	cfg.CookieAuthKey, err = cookieKey(root)
	if err != nil {
		return err
	}
	cfg.CookieEncKey = ""

	db := database.NewMgr(cfg)
	defer db.DB.Close()
	app, err := api.NewAPI(db, cfg, os.DirFS("."))
	if err != nil {
		return err
	}
	if input != nil {
		if err := app.RestoreFreshInstance(ctx, input); err != nil {
			return fmt.Errorf("restore %s: %w", restore, err)
		}
	}
	if resetUser != "" {
		if err := resetPassword(ctx, db.DB, resetUser); err != nil {
			return err
		}
		log.Printf("Reset password for dev account %q", resetUser)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	initialized = true

	srv := &http.Server{Handler: app.Handler(), ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	ctx, stop := context.WithCancel(ctx)
	defer stop()
	go func() { _, _ = io.Copy(io.Discard, os.Stdin); stop() }()
	done := make(chan error, 1)
	go func() { done <- srv.Serve(ln) }()
	fmt.Println("ready")
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return srv.Shutdown(shutdown)
	}
}

func cookieKey(root string) (string, error) {
	path := filepath.Join(root, "cookie-auth.key")
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
			return "", errors.New("dev cookie key must be a private (0600) regular file")
		}
		key, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		if decoded, err := hex.DecodeString(string(key)); err != nil || len(decoded) != 32 {
			return "", errors.New("invalid dev cookie key")
		}
		return string(key), nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	var bytes [32]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	key := hex.EncodeToString(bytes[:])
	return key, os.WriteFile(path, []byte(key), 0600)
}

func resetPassword(ctx context.Context, db *sql.DB, user string) error {
	hash, err := argon2id.CreateHash(fmt.Sprintf("%x", md5.Sum([]byte("antholume"))), argon2id.DefaultParams)
	if err != nil {
		return err
	}
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return err
	}
	updated, err := db.ExecContext(ctx, `UPDATE users SET pass=?, auth_hash=? WHERE id=?`, hash, hex.EncodeToString(token), user)
	if err != nil {
		return err
	}
	count, err := updated.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return fmt.Errorf("dev account %q not found", user)
	}
	return nil
}
