package api

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestCredentialWorkIsBoundedAndStorageFailureDoesNotExpireIdentity(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	for i := 0; i < cap(f.api.identitySlots); i++ {
		f.api.identitySlots <- struct{}{}
	}
	r := f.call("POST", "/api/v1/session/login", Credentials{Username: "alice", Password: "password"}, nil)
	assertProblem(t, r, 503, "service_unavailable")
	require.Equal(t, "60", r.header.Get("Retry-After"))
	for i := 0; i < cap(f.api.identitySlots); i++ {
		<-f.api.identitySlots
	}
	require.NoError(t, f.db.DB.Close())
	assertProblem(t, f.call("GET", "/api/v1/documents", nil, nil), 500, "storage_error")
	assertProblem(t, f.call("GET", "/api/v1/session", nil, nil), 500, "storage_error")
}
