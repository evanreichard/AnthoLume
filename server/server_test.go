package server

import (
	"context"
	"testing"
	"testing/fstest"
	"testing/synctest"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
)

func TestTaskContextStartsAtEachTick(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		const interval, budget = 15 * time.Minute, 5 * time.Minute
		parent, stop := context.WithCancel(t.Context())
		defer stop()
		start := time.Now()
		calls := make(chan context.Context)
		go runTaskRunner(parent, interval, budget, func(ctx context.Context) { calls <- ctx })
		for i := 1; i <= 2; i++ {
			ctx := <-calls
			deadline, ok := ctx.Deadline()
			require.True(t, ok)
			require.Equal(t, start.Add(time.Duration(i)*interval+budget), deadline)
			synctest.Wait()
			require.ErrorIs(t, ctx.Err(), context.Canceled)
		}
	})
}

func TestShutdownDrainsWorkerBeforeClosingDatabase(t *testing.T) {
	root := t.TempDir()
	c := &config.Config{Version: "test", DBType: "sqlite", DBName: "scheduler", ConfigPath: root, DataPath: root, PublicOrigin: "http://127.0.0.1:8585", CookieAuthKey: "synthetic-scheduler-test-secret-key"}
	s, err := New(c, fstest.MapFS{"assets/app/shell-paths.json": {Data: []byte(`["/"]`)}})
	require.NoError(t, err)
	t.Cleanup(s.Stop)
	var workerErr error
	s.wg.Go(func() {
		<-s.workerCtx.Done()
		workerErr = s.db.DB.Ping()
	})
	s.Stop()
	require.NoError(t, workerErr)
	require.ErrorIs(t, s.workerCtx.Err(), context.Canceled)
	require.Error(t, s.db.DB.Ping())
	s.Stop()
}
