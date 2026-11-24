package hardcover

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/unix"
)

const recordLimit = 64 << 10

var errStorage = errors.New("hardcover: credential storage unavailable")

type credential struct {
	UserID    int64     `json:"user_id"`
	Username  string    `json:"username"`
	Access    string    `json:"access_token"`
	Refresh   string    `json:"refresh_token"`
	ExpiresAt time.Time `json:"expires_at"`
}

type credentialStore struct {
	dir  string
	aead cipher.AEAD
}

func newCredentialStore(dir string) (credentialStore, error) {
	if dir == "" {
		return credentialStore{}, ErrInvalidInput
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return credentialStore{}, errStorage
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return credentialStore{}, errStorage
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return credentialStore{}, errStorage
	}
	s := credentialStore{dir: abs}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	unlock, err := s.lock(ctx, "init.lock")
	if err != nil {
		return credentialStore{}, err
	}
	defer unlock()

	key, err := s.readFile("key")
	if errors.Is(err, fs.ErrNotExist) {
		key = make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			return credentialStore{}, errStorage
		}
		if err := s.writeFile("key", key); err != nil {
			return credentialStore{}, err
		}
	} else if err != nil || len(key) != 32 {
		return credentialStore{}, errStorage
	}
	block, err := aes.NewCipher(key)
	clear(key)
	if err != nil {
		return credentialStore{}, errStorage
	}
	s.aead, err = cipher.NewGCMWithRandomNonce(block)
	if err != nil {
		return credentialStore{}, errStorage
	}
	return s, nil
}

func accountName(account string) string {
	hash := sha256.Sum256([]byte(account))
	return hex.EncodeToString(hash[:])
}

func (s credentialStore) lock(ctx context.Context, name string) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	fd, err := unix.Open(filepath.Join(s.dir, name), unix.O_CREAT|unix.O_RDWR|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, errStorage
	}
	var stat unix.Stat_t
	if unix.Fstat(fd, &stat) != nil || stat.Mode&unix.S_IFMT != unix.S_IFREG || stat.Mode&0777 != 0600 {
		_ = unix.Close(fd)
		return nil, errStorage
	}
	for {
		err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB)
		if err == nil {
			return func() { _ = unix.Close(fd) }, nil
		}
		if !errors.Is(err, unix.EWOULDBLOCK) && !errors.Is(err, unix.EINTR) {
			_ = unix.Close(fd)
			return nil, errStorage
		}
		select {
		case <-ctx.Done():
			_ = unix.Close(fd)
			return nil, ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func (s credentialStore) load(account string) (credential, error) {
	encrypted, err := s.readFile(accountName(account) + ".link")
	if errors.Is(err, fs.ErrNotExist) {
		return credential{}, ErrNotConnected
	}
	if err != nil || len(encrypted) < s.aead.Overhead() {
		return credential{}, errStorage
	}
	plain, err := s.aead.Open(nil, nil, encrypted, []byte(account))
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

func (s credentialStore) save(account string, link credential) error {
	plain, err := json.Marshal(link)
	if err != nil || len(plain)+s.aead.Overhead() > recordLimit {
		return errStorage
	}
	defer clear(plain)
	encrypted := s.aead.Seal(nil, nil, plain, []byte(account))
	return s.writeFile(accountName(account)+".link", encrypted)
}

func (s credentialStore) remove(account string) error {
	err := os.Remove(filepath.Join(s.dir, accountName(account)+".link"))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return errStorage
	}
	return s.syncDir()
}

func (s credentialStore) readFile(name string) ([]byte, error) {
	path := filepath.Join(s.dir, name)
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, fs.ErrNotExist
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() > recordLimit {
		return nil, errStorage
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		return nil, errStorage
	}
	return contents, nil
}

func (s credentialStore) writeFile(name string, contents []byte) error {
	f, err := os.CreateTemp(s.dir, ".pending-")
	if err != nil {
		return errStorage
	}
	defer os.Remove(f.Name())
	_, writeErr := f.Write(contents)
	syncErr := f.Sync()
	closeErr := f.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil || os.Rename(f.Name(), filepath.Join(s.dir, name)) != nil {
		return errStorage
	}
	return s.syncDir()
}

func (s credentialStore) syncDir() error {
	dir, err := os.Open(s.dir)
	if err != nil {
		return errStorage
	}
	defer dir.Close()
	if dir.Sync() != nil {
		return errStorage
	}
	return nil
}
