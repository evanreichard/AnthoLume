package api

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestSSRReaderProgressUsesHeadAndPreservesDisplayUnits(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	r := f.call("GET", "/reader/progress/book-a", nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	empty := decodeWeb[map[string]any](t, r)
	require.Equal(t, "", empty["progress"])
	require.Equal(t, float64(0), empty["percentage"])
	require.Equal(t, 200, f.koWrite("book-a", "ko", 0.98, "KO anchor").status)
	r = f.call("GET", "/reader/progress/book-a", nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	view := decodeWeb[map[string]any](t, r)
	require.Equal(t, "KO anchor", view["progress"])
	require.Equal(t, float64(100), view["percentage"])
	event := progressPayload("1", 0.1234567)
	event["position"] = "web backward anchor"
	require.Equal(t, 200, f.call("POST", "/api/v1/me/reading-progress", event, nil).status)
	r = f.call("GET", "/reader/progress/book-a", nil, nil)
	require.Equal(t, 200, r.status, string(r.body))
	view = decodeWeb[map[string]any](t, r)
	require.Equal(t, "web backward anchor", view["progress"])
	require.Equal(t, 12.35, view["percentage"])
	require.Equal(t, 0.1234567, *f.state().Fraction)
	r = f.call("GET", "/api/ko/syncs/progress/book-a", nil, nil)
	require.Equal(t, 0.1234567, decodeWeb[map[string]any](t, r)["percentage"])
}
