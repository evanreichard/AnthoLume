package api

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/database"
	"reichard.io/antholume/hardcover"
)

func TestRestoreHardcoverKeyFailureAllowsRetryWithoutLinks(t *testing.T) {
	payload := restoreFixtureWithHardcoverLink(t)
	f := newWebFixture(t)
	f.register("live-owner")
	const endpoint = "/api/v1/admin/restore"
	staged := f.call("POST", endpoint, string(payload), map[string]string{"Content-Type": "application/octet-stream"})
	require.Equal(t, 200, staged.status, string(staged.body))
	candidate := decodeWeb[AdminRestore](t, staged)
	restore := AdminRestoreApply{Token: candidate.Token}
	for _, tc := range []struct{ key, code, detail string }{
		{"", "hardcover_key_missing", "HARDCOVER_TOKEN_KEY is not set"},
		{"invalid", "hardcover_key_invalid", "32 bytes encoded as standard base64"},
		{base64.StdEncoding.EncodeToString(make([]byte, 32)), "hardcover_key_mismatch", "could not decrypt"},
	} {
		f.cfg.HardcoverTokenKey = tc.key
		result := f.call("PATCH", endpoint, restore, nil)
		assertProblem(t, result, 400, tc.code)
		require.Contains(t, decodeWeb[Problem](t, result).Detail, tc.detail)
		require.Equal(t, 0, f.count("documents"))
		_, err := os.Stat(filepath.Join(f.cfg.DataPath, "documents", "restored.epub"))
		require.ErrorIs(t, err, os.ErrNotExist)
	}

	restore.ExcludeHardcoverLinks = new(true)
	result := f.call("PATCH", endpoint, restore, nil)
	require.Equal(t, 204, result.status, string(result.body))
	require.Equal(t, 1, f.count("documents"))
	require.Zero(t, f.count("hardcover_links"))
	book, err := os.ReadFile(filepath.Join(f.cfg.DataPath, "documents", "restored.epub"))
	require.NoError(t, err)
	require.Equal(t, "book contents", string(book))
}

func TestRestoreFreshInstanceRequiresKeyForHardcoverLinks(t *testing.T) {
	payload := restoreFixtureWithHardcoverLink(t)
	f := newWebFixture(t)
	err := f.api.RestoreFreshInstance(context.Background(), bytes.NewReader(payload))
	require.ErrorIs(t, err, hardcover.ErrKeyMissing)
	require.Zero(t, f.count("users"))
}

func restoreFixtureWithHardcoverLink(t *testing.T) []byte {
	t.Helper()
	ctx := context.Background()
	f := newWebFixture(t)
	user := f.register("backup-owner").User
	block, err := aes.NewCipher(bytes.Repeat([]byte{1}, 32))
	require.NoError(t, err)
	aead, err := cipher.NewGCMWithRandomNonce(block)
	require.NoError(t, err)
	blob := aead.Seal(nil, nil, []byte("synthetic credential"), []byte(user.AccountId))
	n, err := f.db.Queries.InsertHardcoverCredential(ctx, database.InsertHardcoverCredentialParams{
		AccountID: user.AccountId, Generation: user.ReadingGeneration, Credential: blob,
	})
	require.NoError(t, err)
	require.EqualValues(t, 1, n)
	_, err = f.db.Queries.UpsertDocument(ctx, database.UpsertDocumentParams{
		ID: "backup-book", Filepath: new("restored.epub"), StorageRootID: new(libraryRoot),
	})
	require.NoError(t, err)
	name := filepath.Join(t.TempDir(), adminBackupName)
	require.NoError(t, f.db.BackupSnapshot(ctx, name))
	data, err := os.ReadFile(name)
	require.NoError(t, err)
	return zipStoragePaths(t, adminBackupName, data, []string{"documents/library/restored.epub"}, []byte("book contents"))
}

func TestRestoreMigratesSnapshotBeforeHardcover(t *testing.T) {
	ctx := context.Background()
	name, old := copyPreReactBackup(t)
	upgradeTestBackupTo(t, old, 20261126000001)
	require.NoError(t, old.Close())
	payload, err := os.ReadFile(name)
	require.NoError(t, err)

	f := newWebFixture(t)
	require.NoError(t, f.api.RestoreFreshInstance(ctx, bytes.NewReader(payload)))
	require.Equal(t, 1, f.count("users"))
	require.Equal(t, 2, f.count("documents"))
	require.Zero(t, f.count("hardcover_links"))
}
