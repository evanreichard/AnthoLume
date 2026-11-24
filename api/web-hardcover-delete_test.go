package api

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/hardcover"
)

const deleteHardcoverReader = "/api/v1/admin/users/bob"

func hardcoverReader(f *webFixture) (*webFixture, string) {
	reader := hardcoverBrowser(f)
	user := reader.register("bob").User
	return reader, hardcoverAccountKey(authData{AccountID: user.AccountId, Generation: user.ReadingGeneration})
}

func TestAdminDeletionCleansHardcoverLinkAndRejectsStaleCallback(t *testing.T) {
	m := &mockHardcover{disconnectErr: hardcover.ErrRevocationUnconfirmed}
	f := hardcoverFixture(t, m)
	reader, key := hardcoverReader(f)
	for _, browser := range []*webFixture{f, reader} {
		require.Equal(t, 204, finishHardcover(browser, beginHardcover(browser), f.cfg.PublicOrigin).status)
	}
	pending := beginHardcover(reader)
	assertProblem(t, reader.call("DELETE", deleteHardcoverReader, nil, nil), 403, "forbidden")
	f.exec(`CREATE TRIGGER reject_delete BEFORE DELETE ON users WHEN OLD.id = 'bob' BEGIN SELECT RAISE(ABORT, 'test rejection'); END`)
	require.Equal(t, 500, f.call("DELETE", deleteHardcoverReader, nil, nil).status)
	require.Equal(t, 204, finishHardcover(reader, pending, f.cfg.PublicOrigin).status)
	requireHardcoverJSON(reader, "GET", "", `{"enabled":true,"username":"hardcover-reader","reconnect_required":false}`)
	f.exec(`DROP TRIGGER reject_delete`)

	stale := beginHardcover(reader)
	require.Equal(t, 204, f.call("DELETE", deleteHardcoverReader, nil, nil).status)
	_, err := m.Status(key)
	require.ErrorIs(t, err, hardcover.ErrNotConnected)
	requireHardcoverJSON(f, "GET", "", `{"enabled":true,"username":"hardcover-reader","reconnect_required":false}`)
	r := hardcoverBrowser(f).call("GET", hardcoverCallbackPath+"?"+stale.Encode(), nil, nil)
	require.Equal(t, 303, r.status)
	require.Equal(t, 403, finishHardcover(reader, stale, f.cfg.PublicOrigin).status)
	reader.register("bob")
	requireHardcoverJSON(reader, "GET", "", unlinkedHardcover)
	require.Equal(t, 403, finishHardcover(reader, stale, f.cfg.PublicOrigin).status)
}

func TestAdminDeletionWaitsForInFlightHardcoverCallback(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	m := &mockHardcover{beforeConnect: func() { close(started); <-release }}
	f := hardcoverFixture(t, m)
	reader, key := hardcoverReader(f)
	v := beginHardcover(reader)
	callback, deleted := make(chan webResponse, 1), make(chan webResponse, 1)
	go func() { callback <- finishHardcover(reader, v, f.cfg.PublicOrigin) }()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("callback never reached Hardcover")
	}
	go func() { deleted <- f.call("DELETE", deleteHardcoverReader, nil, nil) }()
	committed := func() bool {
		var count int
		return f.db.DB.QueryRow(`SELECT count(*) FROM users WHERE id = 'bob'`).Scan(&count) == nil && count == 0
	}
	// Release the callback even on timeout so fixture teardown cannot hang.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && !committed() {
		time.Sleep(20 * time.Millisecond)
	}
	beforeRelease := committed()
	close(release)
	require.True(t, beforeRelease, "deletion did not commit during the provider call")
	require.Equal(t, 204, (<-callback).status)
	require.Equal(t, 204, (<-deleted).status)
	_, err := m.Status(key)
	require.ErrorIs(t, err, hardcover.ErrNotConnected)
}

func TestDeletedHardcoverLinkCleanup(t *testing.T) {
	t.Run("integration disabled", func(t *testing.T) {
		f := newWebFixture(t)
		f.register("alice")
		_, key := hardcoverReader(f)
		dir := filepath.Join(f.cfg.ConfigPath, "hardcover")
		require.NoError(t, os.Mkdir(dir, 0700))
		paths := make([]string, 0, 2)
		for _, account := range []string{key, "unrelated"} {
			path := filepath.Join(dir, fmt.Sprintf("%x.link", sha256.Sum256([]byte(account))))
			require.NoError(t, os.WriteFile(path, []byte("encrypted record"), 0600))
			paths = append(paths, path)
		}
		require.Equal(t, 204, f.call("DELETE", deleteHardcoverReader, nil, nil).status)
		require.NoFileExists(t, paths[0])
		require.FileExists(t, paths[1])
	})
	t.Run("request canceled", func(t *testing.T) {
		f := newWebFixture(t)
		m := &mockHardcover{links: map[string]string{"generation:account": "reader"}}
		f.api.hardcover.client = m
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		f.api.cleanupDeletedHardcoverAccount(ctx, "generation:account")
		_, err := m.Status("generation:account")
		require.ErrorIs(t, err, hardcover.ErrNotConnected)
	})
}
