package hardcover

import (
	"context"
	"errors"
	"io/fs"
	"os"
)

// RemoveStoredLink removes a local link without OAuth credentials, when remote revocation isn't available.
func RemoveStoredLink(ctx context.Context, dir, account string) error {
	if account == "" {
		return ErrInvalidInput
	}
	info, err := os.Lstat(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return errStorage
	}
	s := credentialStore{dir: dir}
	unlock, err := s.lock(ctx, accountName(account)+".lock")
	if err != nil {
		return err
	}
	defer unlock()
	return s.remove(account)
}
