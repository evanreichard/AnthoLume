package api

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/hardcover"
)

const deleteHardcoverReader = "/api/v1/admin/users/bob"

func hardcoverReader(f *webFixture) (*webFixture, string) {
	reader := hardcoverBrowser(f)
	user := reader.register("bob").User
	return reader, user.AccountId
}

func linkHardcoverMock(f *webFixture, m *mockHardcover) {
	m.storeLink = func(ctx context.Context, account hardcover.Account) error {
		_, err := f.db.DB.ExecContext(ctx, `INSERT INTO hardcover_links(account_id, credential) VALUES (?, ?) ON CONFLICT(account_id) DO NOTHING`, account.ID, []byte("encrypted credential"))
		return err
	}
}

func TestAdminDeletionCascadesHardcoverLinkAndRevokesAfterCommit(t *testing.T) {
	m := &mockHardcover{}
	f := hardcoverFixture(t, m)
	linkHardcoverMock(f, m)
	reader, accountID := hardcoverReader(f)
	for _, browser := range []*webFixture{f, reader} {
		require.Equal(t, 204, finishHardcover(browser, beginHardcover(browser), f.cfg.PublicOrigin).status)
	}
	type revocation struct {
		account string
		data    string
		links   int
		err     error
	}
	revoked := make(chan revocation, 1)
	m.revokeStored = func(ctx context.Context, accountID string, encrypted []byte) {
		var count int
		err := f.db.DB.QueryRowContext(ctx, `SELECT count(*) FROM hardcover_links`).Scan(&count)
		revoked <- revocation{accountID, string(encrypted), count, err}
	}
	pending := beginHardcover(reader)
	assertProblem(t, reader.call("DELETE", deleteHardcoverReader, nil, nil), 403, "forbidden")
	f.exec(`CREATE TRIGGER reject_delete BEFORE DELETE ON users WHEN OLD.id = 'bob' BEGIN SELECT RAISE(ABORT, 'test rejection'); END`)
	require.Equal(t, 500, f.call("DELETE", deleteHardcoverReader, nil, nil).status)
	require.Empty(t, revoked)
	require.Equal(t, 2, f.count("hardcover_links"))
	require.Equal(t, 204, finishHardcover(reader, pending, f.cfg.PublicOrigin).status)
	f.exec(`DROP TRIGGER reject_delete`)

	stale := beginHardcover(reader)
	// Local Deletion - Upstream revocation is best effort and cannot undo the committed delete.
	require.Equal(t, 204, f.call("DELETE", deleteHardcoverReader, nil, nil).status)
	select {
	case actual := <-revoked:
		require.Equal(t, revocation{accountID, "encrypted credential", 1, nil}, actual)
	default:
		t.Fatal("committed link was not sent for revocation")
	}
	r := hardcoverBrowser(f).call("GET", hardcoverCallbackPath+"?"+stale.Encode(), nil, nil)
	require.Equal(t, 303, r.status)
	require.Equal(t, 403, finishHardcover(reader, stale, f.cfg.PublicOrigin).status)
	reader.register("bob")
	requireHardcoverJSON(reader, "GET", "", unlinkedHardcover)
	require.Equal(t, 1, f.count("hardcover_links"))
}

func TestAdminDeletionDoesNotWaitForProviderCallback(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	m := &mockHardcover{beforeConnect: func() { close(started); <-release }}
	f := hardcoverFixture(t, m)
	linkHardcoverMock(f, m)
	reader, _ := hardcoverReader(f)
	v := beginHardcover(reader)
	callback := make(chan webResponse, 1)
	go func() { callback <- finishHardcover(reader, v, f.cfg.PublicOrigin) }()
	defer close(release)
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("callback never reached Hardcover")
	}
	deleted := make(chan webResponse, 1)
	go func() { deleted <- f.call("DELETE", deleteHardcoverReader, nil, nil) }()
	select {
	case r := <-deleted:
		require.Equal(t, 204, r.status)
	case <-time.After(3 * time.Second):
		t.Fatal("deletion blocked on provider callback")
	}
	// Release the blocked provider and wait before querying to ensure the attempted write cannot recreate the link.
	release <- struct{}{}
	require.Equal(t, 502, (<-callback).status)
	require.Zero(t, f.count("hardcover_links"))
}
