package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestZeroDurationActivityPreservesCreditAndStatistics(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	f.exec("UPDATE documents SET words=10000 WHERE id='book-a'")
	payload := activityPayload()
	payload["duration"] = 0
	require.Equal(t, 200, f.call("POST", "/api/v1/me/activity", payload, nil).status)
	require.NoError(t, f.db.CacheTempTables(context.Background()))
	var seconds, words int
	var wpm float64
	require.NoError(t, f.db.DB.QueryRow("SELECT total_time_seconds,total_words_read,total_wpm FROM document_user_statistics WHERE document_id='book-a' AND user_id='alice'").Scan(&seconds, &words, &wpm))
	require.Zero(t, seconds)
	require.Equal(t, 1000, words)
	require.Zero(t, wpm)
	require.Equal(t, 1, f.count("activity"))
}

func TestReadingExhaustionAndNewEffectResourceChecks(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	event := progressPayload("0", 0.5)
	event["device_id"] = "not-registered"
	assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", event, nil), 403, "forbidden")
	require.Equal(t, 1, f.count("devices"))
	require.Zero(t, f.count("reading_receipts"))
	event["device_id"] = "web-device"
	event["document_id"] = "not-registered"
	assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", event, nil), 404, "not_found")
	require.Equal(t, 2, f.count("documents"))
	f.exec(`INSERT INTO reading_heads(user_id,document_id,revision,position,fraction,device_id,updated_at) VALUES('alice','book-a',999999999999999999,'last position',0.7,'web-device','2026-01-01T00:00:00Z')`)
	event["document_id"] = "book-a"
	event["base_revision"] = "999999999999999999"
	r := f.call("POST", "/api/v1/me/reading-progress", event, nil)
	assertProblem(t, r, 409, "revision_exhausted")
	require.Equal(t, "999999999999999999", *decodeWeb[Problem](t, r).CurrentRevision)
	require.Equal(t, "999999999999999999", f.state().Revision)
	require.Equal(t, "last position", *f.state().Position)
	require.Zero(t, f.count("document_progress"))
	require.Equal(t, 1, f.count("reading_receipts"))
	// Account deletion invalidates the signed session before any retained receipt can be accessed.
	f.exec("DELETE FROM users WHERE id='alice'")
	assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", event, nil), 401, "unauthenticated")
	require.Zero(t, f.count("reading_receipts"))
	require.Zero(t, f.count("reading_heads"))
}
func TestChunkedJSONLimitAndReceiptResponseSchema(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	request, err := http.NewRequest("POST", f.server.URL+"/api/v1/me/reading-progress", io.NopCloser(strings.NewReader(strings.Repeat(" ", 8193))))
	require.NoError(t, err)
	request.ContentLength = -1
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", f.cfg.PublicOrigin)
	request.Header.Set("X-CSRF-Token", f.csrf)
	response, err := f.client.Do(request)
	require.NoError(t, err)
	body, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	response.Body.Close()
	assertProblem(t, webResponse{response.StatusCode, response.Header, body}, 413, "invalid_request")
	require.Zero(t, f.count("reading_receipts"))
	spec, err := GetSwagger()
	require.NoError(t, err)
	progress := progressPayload("0", 0.1)
	progress["event_id"] = strings.ToUpper(progress["event_id"].(string))
	for path, payload := range map[string]any{"/api/v1/me/reading-progress": progress, "/api/v1/me/activity": activityPayload()} {
		r := f.call("POST", path, payload, nil)
		require.Equal(t, 200, r.status, string(r.body))
		var value map[string]any
		require.NoError(t, json.Unmarshal(r.body, &value))
		require.Equal(t, payload.(map[string]any)["event_id"], value["event_id"])
		schema := spec.Components.Schemas["Receipt"].Value
		require.NoError(t, schema.VisitJSON(value))
		value["kind"] = "invented"
		require.Error(t, schema.VisitJSON(value))
	}
}
