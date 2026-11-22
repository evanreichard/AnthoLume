package main

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/alexedwards/argon2id"
	"reichard.io/antholume/api"
	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	args := os.Args[1:]
	if len(args) != 1 || (args[0] != "prepare" && args[0] != "prepare-seed" && args[0] != "clean") {
		log.Fatal("usage: dev-setup <prepare|prepare-seed|clean>")
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

	seedMarker := filepath.Join(root, ".seed-incomplete")
	if rootInfo != nil {
		if _, err := os.Lstat(seedMarker); err == nil {
			return errors.New("interrupted demo seed; inspect data/dev, then run make clean-dev and make dev to retry")
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if action == "prepare-seed" && (rootInfo != nil || restore != "") {
		return errors.New("demo seeding requires a fresh library without RESTORE")
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
	} else if rootInfo != nil {
		if info, err := os.Lstat(dbPath); err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return errors.New("incomplete dev state; inspect data/dev before running make clean-dev")
		}
	}

	fresh := rootInfo == nil
	if fresh {
		if err := os.Mkdir(root, 0700); err != nil {
			return err
		}
	}
	initialized := !fresh
	defer func() {
		if !initialized {
			_ = os.RemoveAll(root)
		}
	}()

	if action == "prepare-seed" {
		if err := os.WriteFile(seedMarker, nil, 0600); err != nil {
			return err
		}
	}
	key, err := cookieKey(root)
	if err != nil {
		return err
	}
	if fresh || resetUser != "" {
		cfg := &config.Config{
			Version: "develop", ConfigPath: root, DataPath: root, DBType: "sqlite", DBName: "antholume",
			PublicOrigin: "http://127.0.0.1", CookieAuthKey: key,
		}
		cfg.EnsureDirectories()
		db := database.NewMgr(cfg)
		defer db.DB.Close()
		if input != nil {
			app, err := api.NewAPI(db, cfg, os.DirFS("."))
			if err != nil {
				return err
			}
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
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	initialized = true

	return nil
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
