package api

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	argon2 "github.com/alexedwards/argon2id"
	"reichard.io/antholume/database"
	"reichard.io/antholume/reading"
)

func randomCSRF() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
func md5Password(password string) string { return fmt.Sprintf("%x", md5.Sum([]byte(password))) }
func rawCredentials(username, password string) (string, string) {
	return strings.TrimSpace(username), md5Password(strings.TrimSpace(password))
}
func (api *API) identitySlot(ctx context.Context) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	select {
	case api.identitySlots <- struct{}{}:
		return func() { <-api.identitySlots }, nil
	default:
		return nil, &reading.Failure{Status: 503, Code: "service_unavailable"}
	}
}
func (api *API) authorizeCredentials(ctx context.Context, username, password string) (*authData, error) {
	release, err := api.identitySlot(ctx)
	if err != nil {
		return nil, err
	}
	defer release()
	user, err := api.db.Queries.GetUser(ctx, username)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if user.Pass == nil || user.AuthHash == nil {
		return nil, errInvalidSession
	}
	if ok, err := argon2.ComparePasswordAndHash(password, *user.Pass); err != nil || !ok {
		return nil, nil
	}
	return &authData{UserName: user.ID, IsAdmin: user.Admin, AuthHash: *user.AuthHash}, nil
}
func (api *API) hashPassword(ctx context.Context, password string) (string, error) {
	release, err := api.identitySlot(ctx)
	if err != nil {
		return "", err
	}
	defer release()
	return argon2.CreateHash(password, argon2.DefaultParams)
}
func (api *API) registerIdentity(ctx context.Context, username, password string) (*authData, error) {
	if !api.cfg.RegistrationEnabled {
		return nil, &reading.Failure{Status: 403, Code: "forbidden"}
	}
	if !utf8.ValidString(username) || utf8.RuneCountInString(username) == 0 || utf8.RuneCountInString(username) > 128 || len(password) == 0 || len(password) > 256 {
		return nil, &reading.Failure{Status: 400, Code: "invalid_request"}
	}
	hash, err := api.hashPassword(ctx, password)
	if err != nil {
		return nil, err
	}
	token, err := randomCSRF()
	if err != nil {
		return nil, err
	}
	tx, err := api.db.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	q := api.db.Queries.WithTx(tx)
	exists, err := q.CountUsersByID(ctx, username)
	if err != nil {
		return nil, err
	}
	if exists != 0 {
		return nil, &reading.Failure{Status: 409, Code: "user_conflict"}
	}
	admin, err := q.IsFirstUser(ctx)
	if err != nil {
		return nil, err
	}
	if err = q.InsertIdentityUser(ctx, database.InsertIdentityUserParams{
		ID: username, Pass: &hash, AuthHash: &token, Admin: admin,
	}); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &authData{UserName: username, IsAdmin: admin, AuthHash: token}, nil
}

type attemptWindow struct {
	start time.Time
	count int
}
type credentialLimiter struct {
	mu      sync.Mutex
	entries map[string]attemptWindow
}

func (l *credentialLimiter) allow(key string) bool {
	_, ok := l.reserve(key)
	return ok
}

// Protocol Admission - KO/OPDS verify credentials on each request; successful checks refund a generation-bound reservation without clearing prior failures.
func (l *credentialLimiter) reserve(key string) (func(), bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if l.entries == nil {
		l.entries = make(map[string]attemptWindow)
	}
	for k, w := range l.entries {
		if now.Sub(w.start) >= time.Minute {
			delete(l.entries, k)
		}
	}
	w, ok := l.entries[key]
	// Bounded Admission - A full table denies new sources instead of evicting a source's active limit.
	if !ok && len(l.entries) >= 1024 {
		return nil, false
	}
	if !ok {
		w.start = now
	}
	if w.count >= 10 {
		return nil, false
	}
	w.count++
	l.entries[key] = w
	var once sync.Once
	return func() {
		once.Do(func() {
			l.mu.Lock()
			defer l.mu.Unlock()
			current, ok := l.entries[key]
			if !ok || !current.start.Equal(w.start) {
				return
			}
			current.count--
			if current.count == 0 {
				delete(l.entries, key)
			} else {
				l.entries[key] = current
			}
		})
	}, true
}

var errInvalidSession = errors.New("invalid session")
