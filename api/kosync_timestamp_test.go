package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func decodeKOTimestamp(t *testing.T, r webResponse) int64 {
	t.Helper()
	fields := decodeWeb[map[string]json.RawMessage](t, r)
	require.Contains(t, fields, "timestamp")
	var timestamp int64
	require.NotEqual(t, "null", string(fields["timestamp"]))
	require.NoError(t, json.Unmarshal(fields["timestamp"], &timestamp), string(r.body))
	return timestamp
}

func TestKOSyncTimestampUsesPersistedAcceptedHead(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	f.client.Jar = nil
	call := func(method, path, body string) webResponse {
		t.Helper()
		req, err := http.NewRequest(method, f.server.URL+path, strings.NewReader(body))
		require.NoError(t, err)
		for key, value := range koHeaders() {
			req.Header.Set(key, value)
		}
		req.Header.Set("Accept", "application/vnd.koreader.v1+json")
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		// Stock Client - Header auth must work without browser cookies, Origin, CSRF or web event fields.
		response, err := f.client.Do(req)
		require.NoError(t, err)
		defer response.Body.Close()
		data, err := io.ReadAll(response.Body)
		require.NoError(t, err)
		return webResponse{response.StatusCode, response.Header, data}
	}

	for _, document := range []string{"unknown", "book_a"} {
		r := call("GET", "/api/ko/syncs/progress/"+document, "")
		require.Equal(t, 200, r.status, string(r.body))
		require.Equal(t, "{}", string(r.body))
	}

	// Distinct Clocks - A legacy row timestamp must not replace the accepted shared-head instant in PUT.
	f.exec(`CREATE TRIGGER timestamp_test_legacy_clock AFTER INSERT ON document_progress BEGIN
 UPDATE document_progress SET created_at='2001-02-03T04:05:06Z'
 WHERE user_id=NEW.user_id AND document_id=NEW.document_id AND device_id=NEW.device_id;
 END`)
	// Upstream Golden - Pinned server spec writes .32 then .22, retaining the later lower fraction.
	for _, write := range []struct {
		fraction float64
		position string
		device   string
	}{
		{0.32, "56", "my kpw"},
		{0.22, "36", "my pb"},
		{0.22, "  opaque 雪 /not-an-xpath\t\n\x00e\u0301  ", "my pb"},
	} {
		body, err := json.Marshal(map[string]any{"document": "89isjkdaj9j", "percentage": write.fraction, "progress": write.position, "device": write.device, "device_id": "reader"})
		require.NoError(t, err)
		before := time.Now().Unix()
		r := call("PUT", "/api/ko/syncs/progress", string(body))
		require.Equal(t, 200, r.status, string(r.body))
		require.Equal(t, "application/json", r.header.Get("Content-Type"))
		timestamp := decodeKOTimestamp(t, r)
		require.GreaterOrEqual(t, timestamp, before)
		require.LessOrEqual(t, timestamp, time.Now().Unix())
		require.JSONEq(t, fmt.Sprintf(`{"document":"89isjkdaj9j","timestamp":%d}`, timestamp), string(r.body))

		var persisted string
		require.NoError(t, f.db.DB.QueryRow(`SELECT updated_at FROM reading_heads WHERE user_id='alice' AND document_id='89isjkdaj9j'`).Scan(&persisted))
		acceptedAt, err := time.Parse(time.RFC3339, persisted)
		require.NoError(t, err)
		require.Equal(t, acceptedAt.Unix(), timestamp)
		r = call("GET", "/api/ko/syncs/progress/89isjkdaj9j", "")
		require.Equal(t, 200, r.status, string(r.body))
		require.Equal(t, timestamp, decodeKOTimestamp(t, r))
		fields := decodeWeb[map[string]any](t, r)
		require.Equal(t, write.fraction, fields["percentage"])
		require.Equal(t, write.position, fields["progress"])
		require.Equal(t, write.device, fields["device"])
	}

	persisted := "2003-04-05T06:07:08.987654321+02:00"
	f.exec(`UPDATE reading_heads SET updated_at=? WHERE user_id='alice' AND document_id='89isjkdaj9j'`, persisted)
	instant, err := time.Parse(time.RFC3339Nano, persisted)
	require.NoError(t, err)
	for range 2 {
		r := call("GET", "/api/ko/syncs/progress/89isjkdaj9j", "")
		require.Equal(t, 200, r.status, string(r.body))
		require.Equal(t, instant.Unix(), decodeKOTimestamp(t, r))
	}
	var unchanged string
	require.NoError(t, f.db.DB.QueryRow(`SELECT updated_at FROM reading_heads WHERE user_id='alice' AND document_id='89isjkdaj9j'`).Scan(&unchanged))
	require.Equal(t, persisted, unchanged)
}

func TestKOSyncTimestampTracksWebOriginHead(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	r := f.koWrite("book_a", "reader", 0.8, "KO position")
	require.Equal(t, 200, r.status, string(r.body))
	koTimestamp := decodeKOTimestamp(t, r)
	// Distinct Instants - Make head acceptance distinguishable from the prior KO write and the client's observed_at.
	f.exec(`CREATE TRIGGER timestamp_test_web_clock AFTER UPDATE ON reading_heads BEGIN
 UPDATE reading_heads SET updated_at='2004-05-06T07:08:09Z'
 WHERE user_id=NEW.user_id AND document_id=NEW.document_id;
 END`)
	payload := progressPayload("1", 0.2)
	payload["position"] = "web-origin exact position"
	r = f.call("POST", "/api/v1/me/reading-progress", payload, nil)
	require.Equal(t, 200, r.status, string(r.body))
	head := f.state()
	require.Equal(t, "2", head.Revision)
	require.NotEqual(t, koTimestamp, head.UpdatedAt.Unix())
	f.client.Jar = nil
	r = f.call("GET", "/api/ko/syncs/progress/book_a", nil, koHeaders())
	require.Equal(t, 200, r.status, string(r.body))
	require.Equal(t, head.UpdatedAt.Unix(), decodeKOTimestamp(t, r))
	fields := decodeWeb[map[string]any](t, r)
	require.Equal(t, payload["position"], fields["progress"])
	require.Equal(t, 0.2, fields["percentage"])
	require.Equal(t, "web-device", fields["device_id"])
}
