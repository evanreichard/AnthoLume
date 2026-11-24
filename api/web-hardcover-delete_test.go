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

type deletionHardcover struct {
	*mockHardcover
	connectStarted chan struct{}
	finishConnect  chan struct{}
	disconnects    []string
	disconnectErr  error
}

func (m *deletionHardcover) Connect(ctx context.Context, account, code, verifier string) error {
	if m.connectStarted != nil {
		close(m.connectStarted)
		select {
		case <-m.finishConnect:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return m.mockHardcover.Connect(ctx, account, code, verifier)
}

func (m *deletionHardcover) Disconnect(ctx context.Context, account string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.disconnects = append(m.disconnects, account)
	delete(m.links, account)
	return m.disconnectErr
}

func deletionAccountKey(session Session) string {
	return hardcoverAccountKey(authData{AccountID: session.User.AccountId, Generation: session.User.ReadingGeneration})
}

func TestAdminDeletionCleansHardcoverLinkAndRejectsStaleCallback(t *testing.T) {
	f := newWebFixture(t)
	m := &deletionHardcover{mockHardcover: &mockHardcover{links: make(map[string]string)}, disconnectErr: hardcover.ErrRevocationUnconfirmed}
	f.api.hardcover.client = m
	admin := f.register("alice")
	reader := hardcoverBrowser(f)
	original := reader.register("bob")
	key := deletionAccountKey(original)
	require.Equal(t, 204, finishHardcover(f, beginHardcover(f), f.cfg.PublicOrigin).status)
	require.Equal(t, 204, finishHardcover(reader, beginHardcover(reader), f.cfg.PublicOrigin).status)
	stale := beginHardcover(reader)

	path := "/api/v1/admin/users/bob"
	assertProblem(t, reader.call("DELETE", path, nil, nil), 403, "forbidden")
	f.exec(`CREATE TRIGGER reject_delete BEFORE DELETE ON users WHEN OLD.id = 'bob' BEGIN SELECT RAISE(ABORT, 'test rejection'); END`)
	require.Equal(t, 500, f.call("DELETE", path, nil, nil).status)
	require.Empty(t, m.disconnects)
	_, err := m.Status(key)
	require.NoError(t, err)
	require.True(t, f.api.hardcover.live(stale.Get("state"), time.Now()))
	f.exec(`DROP TRIGGER reject_delete`)

	require.Equal(t, 204, f.call("DELETE", path, nil, nil).status)
	require.Equal(t, []string{key}, m.disconnects)
	_, err = m.Status(key)
	require.ErrorIs(t, err, hardcover.ErrNotConnected)
	_, err = m.Status(deletionAccountKey(admin))
	require.NoError(t, err)
	require.False(t, f.api.hardcover.live(stale.Get("state"), time.Now()))
	require.Equal(t, 403, finishHardcover(reader, stale, f.cfg.PublicOrigin).status)

	recreated := reader.register("bob")
	require.NotEqual(t, key, deletionAccountKey(recreated))
	require.Nil(t, decodeWeb[HardcoverStatus](t, reader.call("GET", hardcoverPath, nil, nil)).Username)
	require.Equal(t, 403, finishHardcover(reader, stale, f.cfg.PublicOrigin).status)
	require.Equal(t, 2, m.exchanges())
}

func TestAdminDeletionWaitsForHardcoverCallbackBeforeRemovingLink(t *testing.T) {
	f := newWebFixture(t)
	m := &deletionHardcover{
		mockHardcover: &mockHardcover{links: make(map[string]string)}, connectStarted: make(chan struct{}), finishConnect: make(chan struct{}),
	}
	f.api.hardcover.client = m
	f.register("alice")
	reader := hardcoverBrowser(f)
	key := deletionAccountKey(reader.register("bob"))
	values := beginHardcover(reader)
	callback := make(chan webResponse, 1)
	go func() { callback <- finishHardcover(reader, values, f.cfg.PublicOrigin) }()
	select {
	case <-m.connectStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("callback never started")
	}

	deleted := make(chan webResponse, 1)
	go func() { deleted <- f.call("DELETE", "/api/v1/admin/users/bob", nil, nil) }()
	committed := false
	deadline := time.Now().Add(3 * time.Second)
	for !committed && time.Now().Before(deadline) {
		var count int
		committed = f.db.DB.QueryRow(`SELECT count(*) FROM users WHERE id = 'bob'`).Scan(&count) == nil && count == 0
		if !committed {
			time.Sleep(20 * time.Millisecond)
		}
	}
	close(m.finishConnect)
	require.True(t, committed, "deletion did not commit while the provider was in flight")
	require.Equal(t, 204, (<-callback).status)
	require.Equal(t, 204, (<-deleted).status)
	_, err := m.Status(key)
	require.ErrorIs(t, err, hardcover.ErrNotConnected)
	require.Equal(t, []string{key}, m.disconnects)
}

func TestAdminDeletionRemovesStoredHardcoverLinkWhenDisabled(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	reader := hardcoverBrowser(f)
	original := reader.register("bob")
	key := deletionAccountKey(original)
	oldKey := hardcoverAccountKey(authData{AccountID: original.User.AccountId, Generation: "other-generation"})
	dir := filepath.Join(f.cfg.ConfigPath, "hardcover")
	require.NoError(t, os.Mkdir(dir, 0700))
	file := filepath.Join(dir, fmt.Sprintf("%x.link", sha256.Sum256([]byte(key))))
	other := filepath.Join(dir, fmt.Sprintf("%x.link", sha256.Sum256([]byte(oldKey))))
	require.NoError(t, os.WriteFile(file, []byte("encrypted record"), 0600))
	require.NoError(t, os.WriteFile(other, []byte("unrelated encrypted record"), 0600))

	require.Equal(t, 204, f.call("DELETE", "/api/v1/admin/users/bob", nil, nil).status)
	require.NoFileExists(t, file)
	require.FileExists(t, other)
}

func TestDeletedHardcoverCleanupOutlivesCanceledRequest(t *testing.T) {
	f := newWebFixture(t)
	m := &deletionHardcover{mockHardcover: &mockHardcover{links: map[string]string{"generation:account": "reader"}}}
	f.api.hardcover.client = m
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	f.api.cleanupDeletedHardcoverAccount(ctx, "generation:account")
	_, err := m.Status("generation:account")
	require.ErrorIs(t, err, hardcover.ErrNotConnected)
}
