package api

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestAdminJobShutdownCancelsAndDrainsBeforeCompletion(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	f.exec(`UPDATE users SET admin=1 WHERE id='owner'`)
	now := time.Now()
	deadline := now.Add(adminJobLifetime)
	f.exec(`INSERT INTO admin_jobs (id,kind,status,started_at,deadline) VALUES ('active','database_check','running',?,?)`, jobTime(now), jobTime(deadline))

	cancelled, cleanup := make(chan struct{}), make(chan struct{})
	started := make(chan struct{})
	require.True(t, f.api.adminJobs.reserve())
	go f.api.finishAdminWork("active", "database_check", deadline, func(ctx context.Context) error {
		close(started)
		<-ctx.Done()
		close(cancelled)
		<-cleanup
		return ctx.Err()
	})
	defer func() {
		select {
		case <-cleanup:
		default:
			close(cleanup)
		}
	}()
	<-started

	shutdown := make(chan error, 1)
	go func() { shutdown <- f.api.Stop() }()
	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not cancel manual work")
	}
	select {
	case <-shutdown:
		t.Fatal("shutdown returned before manual cleanup")
	default:
	}
	assertProblem(t, f.call("POST", "/api/v1/admin/jobs", map[string]string{"kind": "database_check"}, nil), 503, "server_busy")
	close(cleanup)
	select {
	case err := <-shutdown:
		require.NoError(t, err)
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not drain manual work")
	}
	var status string
	var finished *string
	require.NoError(t, f.db.DB.QueryRow(`SELECT status, finished_at FROM admin_jobs WHERE id='active'`).Scan(&status, &finished))
	require.Equal(t, "interrupted", status)
	require.NotNil(t, finished)
	require.Equal(t, 1, f.count("admin_jobs"))
}

func TestAdminJobRestartInterruptsOrphanAndAllowsRetry(t *testing.T) {
	f := newWebFixture(t)
	f.register("owner")
	f.exec(`UPDATE users SET admin=1 WHERE id='owner'`)
	now := time.Now()
	f.exec(`INSERT INTO admin_jobs (id,kind,status,started_at,deadline) VALUES ('orphan','database_check','running',?,?)`, jobTime(now), jobTime(now.Add(adminJobLifetime)))

	f.server.Close()
	require.NoError(t, f.api.Stop())
	f.start()
	f.bootstrap()
	r := f.call("POST", "/api/v1/session/login", Credentials{Username: "owner", Password: "password"}, nil)
	require.Equal(t, 200, r.status, string(r.body))
	f.setSession(decodeWeb[Session](t, r))
	r = f.call("GET", "/api/v1/admin/jobs?kind=database_check", nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	rows := decodeWeb[[]AdminJob](t, r)
	require.Len(t, rows, 1)
	require.Equal(t, AdminJobStatus("interrupted"), rows[0].Status)
	require.NotNil(t, rows[0].FinishedAt)

	r = f.call("POST", "/api/v1/admin/jobs", map[string]string{"kind": "database_check"}, nil)
	require.Equal(t, 202, r.status, string(r.body))
	job := decodeWeb[AdminJob](t, r)
	require.NotEqual(t, "orphan", job.Id)
	require.Eventually(t, func() bool {
		var status string
		err := f.db.DB.QueryRow(`SELECT status FROM admin_jobs WHERE id=?`, job.Id).Scan(&status)
		return err == nil && status == "succeeded"
	}, 3*time.Second, 20*time.Millisecond)
}
