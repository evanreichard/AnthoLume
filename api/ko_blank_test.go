package api

import (
	"fmt"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestKOBlankLegacyPositionIsDistinctFromMissingState(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	r := f.call("PUT", "/api/ko/syncs/progress", `{"document":"blank","device_id":"legacy","device":"","progress":"","percentage":0}`, nil)
	require.Equal(t, 200, r.status, string(r.body))
	timestamp := decodeKOTimestamp(t, r)
	r = f.call("GET", "/api/ko/syncs/progress/blank", nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.JSONEq(t, fmt.Sprintf(`{"document":"blank","percentage":0,"progress":"","device":"","device_id":"legacy","timestamp":%d}`, timestamp), string(r.body))
	r = f.call("GET", "/api/ko/syncs/progress/no-state", nil, nil)
	require.JSONEq(t, `{}`, string(r.body))
	assertProblem(t, f.call("POST", "/api/v1/me/devices", Device{Id: "new-web", Name: ""}, nil), 400, "invalid_request")
}
