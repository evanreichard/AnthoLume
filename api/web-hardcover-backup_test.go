package api

import (
	"bytes"
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

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
