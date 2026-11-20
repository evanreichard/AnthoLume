package api

import (
	"database/sql"
	"net/http"
	"net/http/cookiejar"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAdminUsersRequireCurrentRoleAndVerifiedRecovery(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	path := "/api/v1/admin/users"
	created := f.call("POST", path, AdminUserCreate{Username: "bob", Password: "member password", IsAdmin: true}, nil)
	require.Equal(t, 201, created.status, string(created.body))
	require.JSONEq(t, `{"id":"bob","is_admin":true}`, string(created.body))
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	other := *f
	other.client = &http.Client{Jar: jar}
	other.bootstrap()
	require.Equal(t, 200, other.call("POST", "/api/v1/session/login", Credentials{Username: "bob", Password: "member password"}, nil).status)
	other.bootstrap()
	listed := other.call("GET", path, nil, nil)
	require.Equal(t, 200, listed.status, string(listed.body))
	require.JSONEq(t, `[{"id":"alice","is_admin":true},{"id":"bob","is_admin":true}]`, string(listed.body))
	assertProblem(t, f.call("DELETE", path+"/alice", nil, nil), 409, "current_admin")
	admin := false
	require.Equal(t, 200, f.call("PATCH", path+"/bob", AdminUserUpdate{IsAdmin: &admin}, nil).status)
	assertProblem(t, other.call("GET", path, nil, nil), 403, "forbidden")
	assertProblem(t, other.call("DELETE", path+"/alice", nil, nil), 403, "forbidden")
	password := "replacement password"
	require.Equal(t, 200, f.call("PATCH", path+"/bob", AdminUserUpdate{Password: &password}, nil).status)
	assertProblem(t, other.call("GET", path, nil, nil), 401, "unauthenticated")
	root := filepath.Join(f.cfg.ConfigPath, "backups")
	require.NoError(t, os.RemoveAll(root))
	require.NoError(t, os.WriteFile(root, []byte("not a directory"), 0600))
	assertProblem(t, f.call("DELETE", path+"/bob", nil, nil), 500, "storage_error")
	require.Equal(t, 2, f.count("users"))
	require.NoError(t, os.Remove(root))
	deleted := f.call("DELETE", path+"/bob", nil, nil)
	require.Equal(t, 204, deleted.status, string(deleted.body))
	require.Equal(t, 1, f.count("users"))
	copies, err := filepath.Glob(filepath.Join(root, "before-user-delete-*", "antholume.db"))
	require.NoError(t, err)
	require.Len(t, copies, 1)
	recovery, err := sql.Open("sqlite", copies[0])
	require.NoError(t, err)
	defer recovery.Close()
	var count int
	require.NoError(t, recovery.QueryRow(`SELECT count(*) FROM users WHERE id='bob'`).Scan(&count))
	require.Equal(t, 1, count)
}
