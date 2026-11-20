package server

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
)

func TestTaskContextStartsAtEachTickAndShutdownDrains(t *testing.T) {
	root := t.TempDir()
	c := &config.Config{Version: "test", DBType: "sqlite", DBName: "scheduler", ConfigPath: root, DataPath: root, PublicOrigin: "http://127.0.0.1:8585", CookieAuthKey: "synthetic-scheduler-test-secret-key"}
	s, err := New(c, os.DirFS(".."))
	require.NoError(t, err)
	t.Cleanup(s.Stop)
	_, err = s.db.DB.Exec(`INSERT INTO users(id,pass,auth_hash) VALUES('a','p','h'); INSERT INTO documents(id,words) VALUES('d',10000); INSERT INTO devices(id,user_id,device_name) VALUES('v','a','V'); INSERT INTO activity(user_id,document_id,device_id,start_time,start_percentage,end_percentage,duration) VALUES('a','d','v','2026-01-01T00:00:00Z',0,0.1,30)`)
	require.NoError(t, err)
	s.wg.Add(1)
	go func() { defer s.wg.Done(); s.runTaskRunner(500*time.Millisecond, 300*time.Millisecond) }()
	total := func() int {
		var value int
		_ = s.db.DB.QueryRow("SELECT total_time_seconds FROM document_user_statistics WHERE user_id='a' AND document_id='d'").Scan(&value)
		return value
	}
	// The first tick is later than the job timeout; a startup-created deadline would already be expired.
	require.Eventually(t, func() bool { return total() == 30 }, 3*time.Second, 10*time.Millisecond)
	_, err = s.db.DB.Exec(`INSERT INTO activity(user_id,document_id,device_id,start_time,start_percentage,end_percentage,duration) VALUES('a','d','v','2026-01-02T00:00:00Z',0.1,0.2,20)`)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return total() == 50 }, 3*time.Second, 10*time.Millisecond)
	stopped := make(chan struct{})
	go func() { s.Stop(); close(stopped) }()
	select {
	case <-stopped:
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not drain the worker")
	}
	require.ErrorIs(t, s.workerCtx.Err(), context.Canceled)
	require.Error(t, s.db.DB.Ping())
	s.Stop()
}
