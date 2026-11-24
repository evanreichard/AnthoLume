package hardcover

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"reichard.io/antholume/database"
)

var errStorage = errors.New("hardcover: credential storage unavailable")

type credential struct {
	UserID    int64     `json:"user_id"`
	Username  string    `json:"username"`
	Access    string    `json:"access_token"`
	Refresh   string    `json:"refresh_token"`
	ExpiresAt time.Time `json:"expires_at"`
}

type credentialStore struct {
	queries *database.Queries
	cipher.AEAD
}

type accountRef struct{ generation, id string }

func parseAccount(account string) (accountRef, error) {
	generation, id, ok := strings.Cut(account, ":")
	if !ok || generation == "" || id == "" {
		return accountRef{}, ErrInvalidInput
	}
	return accountRef{generation, id}, nil
}

func newCredentialStore(db *sql.DB, key []byte) (credentialStore, error) {
	if db == nil || len(key) != 32 {
		return credentialStore{}, ErrInvalidInput
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return credentialStore{}, errStorage
	}
	aead, err := cipher.NewGCMWithRandomNonce(block)
	return credentialStore{database.New(db), aead}, err
}

func (s credentialStore) load(ctx context.Context, account accountRef) (credential, []byte, error) {
	blob, err := s.queries.GetHardcoverCredential(ctx, database.GetHardcoverCredentialParams{
		AccountID: account.id, Generation: account.generation,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return credential{}, nil, ErrNotConnected
	}
	if err != nil {
		return credential{}, nil, errStorage
	}
	if blob == nil {
		return credential{}, nil, nil
	}
	link, err := s.decode(account.id, blob)
	return link, blob, err
}

func (s credentialStore) decode(id string, blob []byte) (credential, error) {
	plain, err := s.Open(nil, nil, blob, []byte(id))
	if err != nil {
		return credential{}, errStorage
	}
	defer clear(plain)
	var link credential
	if json.Unmarshal(plain, &link) != nil || link.UserID < 1 || link.Username == "" || link.Access == "" || link.ExpiresAt.IsZero() {
		return credential{}, errStorage
	}
	return link, nil
}

// Compare and Swap - Keep only the writer that read the current credential and generation, even across processes.
func (s credentialStore) save(ctx context.Context, account accountRef, old []byte, link credential) ([]byte, error) {
	plain, err := json.Marshal(link)
	if err != nil {
		return nil, errStorage
	}
	defer clear(plain)
	blob := s.Seal(nil, nil, plain, []byte(account.id))
	var count int64
	if old == nil {
		count, err = s.queries.InsertHardcoverCredential(ctx, database.InsertHardcoverCredentialParams{
			AccountID: account.id, Generation: account.generation, Credential: blob,
		})
	} else {
		count, err = s.queries.ReplaceHardcoverCredential(ctx, database.ReplaceHardcoverCredentialParams{
			AccountID: account.id, Generation: account.generation, Credential: blob, Previous: old,
		})
	}
	if err != nil {
		return nil, errStorage
	}
	if count != 1 {
		return nil, ErrNotConnected
	}
	return blob, nil
}

func (s credentialStore) remove(ctx context.Context, account accountRef) ([]byte, error) {
	blob, err := s.queries.RemoveHardcoverCredential(ctx, database.RemoveHardcoverCredentialParams{
		AccountID: account.id, Generation: account.generation,
	})
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, errStorage
	}
	return blob, nil
}
