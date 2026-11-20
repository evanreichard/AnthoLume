package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/database"
)

func koDeviceHTTP(t *testing.T, f *webFixture, user, method, path string, body any) webResponse {
	t.Helper()
	var data []byte
	if body != nil {
		var err error
		data, err = json.Marshal(body)
		require.NoError(t, err)
	}
	req, err := http.NewRequest(method, f.server.URL+path, bytes.NewReader(data))
	require.NoError(t, err)
	req.Header.Set("x-auth-user", user)
	req.Header.Set("x-auth-key", koHeaders()["x-auth-key"])
	req.Header.Set("Accept", "application/vnd.koreader.v1+json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(req)
	require.NoError(t, err)
	defer response.Body.Close()
	data, err = io.ReadAll(response.Body)
	require.NoError(t, err)
	return webResponse{response.StatusCode, response.Header, data}
}

func koDevicePayload(document, name string) map[string]any {
	return map[string]any{"document": document, "percentage": 0.32, "progress": "56", "device": name}
}

func TestKOSyncDevicesOfficialOptionalIDGolden(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	// Official Oracle - Pinned syncs_controller_spec.lua #sync accepts and returns this vector without device_id.
	payload := koDevicePayload("89isjkdaj9j", "my kpw")
	r := koDeviceHTTP(t, f, "alice", "PUT", "/api/ko/syncs/progress", payload)
	require.Equal(t, 200, r.status, string(r.body))
	timestamp := decodeKOTimestamp(t, r)
	r = koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/89isjkdaj9j", nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.JSONEq(t, fmt.Sprintf(`{"document":"89isjkdaj9j","percentage":0.32,"progress":"56","device":"my kpw","timestamp":%d}`, timestamp), string(r.body))
	payload["percentage"], payload["progress"], payload["device"] = 0.22, "36", "my pb"
	r = koDeviceHTTP(t, f, "alice", "PUT", "/api/ko/syncs/progress", payload)
	require.Equal(t, 200, r.status, string(r.body))
	timestamp = decodeKOTimestamp(t, r)
	r = koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/89isjkdaj9j", nil)
	require.JSONEq(t, fmt.Sprintf(`{"document":"89isjkdaj9j","percentage":0.22,"progress":"36","device":"my pb","timestamp":%d}`, timestamp), string(r.body))

	for i, id := range []string{"", "  ", "reader-global"} {
		payload = koDevicePayload(fmt.Sprintf("optional%d", i), "")
		payload["device_id"], payload["progress"] = id, ""
		r = koDeviceHTTP(t, f, "alice", "PUT", "/api/ko/syncs/progress", payload)
		require.Equal(t, 200, r.status, string(r.body))
		timestamp = decodeKOTimestamp(t, r)
		r = koDeviceHTTP(t, f, "alice", "GET", fmt.Sprintf("/api/ko/syncs/progress/optional%d", i), nil)
		require.Equal(t, 200, r.status, string(r.body))
		fields := decodeWeb[map[string]any](t, r)
		require.Equal(t, id, fields["device_id"])
		require.Equal(t, "", fields["device"])
		require.Equal(t, "", fields["progress"])
		require.Len(t, fields, 6)
		require.Equal(t, timestamp, decodeKOTimestamp(t, r))
		delete(payload, "device_id")
		require.Equal(t, 200, koDeviceHTTP(t, f, "alice", "PUT", "/api/ko/syncs/progress", payload).status)
		r = koDeviceHTTP(t, f, "alice", "GET", fmt.Sprintf("/api/ko/syncs/progress/optional%d", i), nil)
		require.Equal(t, id, decodeWeb[map[string]any](t, r)["device_id"], "upstream HSET retains existing optional ID")
	}
	r = koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/unknown", nil)
	require.Equal(t, 200, r.status)
	require.Equal(t, "{}", string(r.body))
}

func TestKOSyncDevicesSameExternalIDAcrossAccounts(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	require.Equal(t, 200, f.call("POST", "/api/v1/session/logout", map[string]any{}, nil).status)
	f.register("bob")
	f.exec(`INSERT INTO users(id,pass,auth_hash) VALUES('original-owner','synthetic','hash'); INSERT INTO devices(id,user_id,device_name) VALUES('physical-reader','original-owner','Original name')`)
	for _, user := range []string{"alice", "bob"} {
		r := koDeviceHTTP(t, f, user, "GET", "/api/ko/syncs/progress/sharedbook", nil)
		require.Equal(t, 200, r.status)
		require.Equal(t, "{}", string(r.body))
		payload := koDevicePayload("sharedbook", user+" reader")
		payload["device_id"], payload["progress"] = "physical-reader", user+" opaque 雪"
		r = koDeviceHTTP(t, f, user, "PUT", "/api/ko/syncs/progress", payload)
		require.Equal(t, 200, r.status, string(r.body))
	}
	for _, user := range []string{"alice", "bob"} {
		r := koDeviceHTTP(t, f, user, "GET", "/api/ko/syncs/progress/sharedbook", nil)
		require.Equal(t, 200, r.status)
		fields := decodeWeb[map[string]any](t, r)
		require.Equal(t, "physical-reader", fields["device_id"])
		require.Equal(t, user+" reader", fields["device"])
		require.Equal(t, user+" opaque 雪", fields["progress"])
	}
	var owner, name string
	require.NoError(t, f.db.DB.QueryRow(`SELECT user_id,device_name FROM devices WHERE id='physical-reader' AND user_id='original-owner'`).Scan(&owner, &name))
	require.Equal(t, "original-owner", owner)
	require.Equal(t, "Original name", name)
	var distinct int
	require.NoError(t, f.db.DB.QueryRow(`SELECT count(*) FROM devices WHERE id='physical-reader'`).Scan(&distinct))
	require.Equal(t, 3, distinct)
	const oldSync int64 = 1767225600
	cursor := func(user string, want int64) {
		t.Helper()
		r := koDeviceHTTP(t, f, user, "POST", "/api/ko/syncs/activity", map[string]any{"device_id": "physical-reader", "device": user + " reader"})
		require.Equal(t, 200, r.status, string(r.body))
		require.Equal(t, want, decodeWeb[struct {
			LastSync int64 `json:"last_sync"`
		}](t, r).LastSync)
	}
	cursor("alice", 0)
	cursor("bob", 0)
	for i, user := range []string{"alice", "bob"} {
		r := koDeviceHTTP(t, f, user, "POST", "/api/ko/syncs/documents", map[string]any{"device_id": "physical-reader", "device": user + " reader", "have": []string{"sharedbook"}})
		require.Equal(t, 200, r.status, string(r.body))
		start := oldSync + int64(i+1)*60
		r = koDeviceHTTP(t, f, user, "POST", "/api/ko/activity", map[string]any{"device_id": "physical-reader", "device": user + " reader", "activity": []map[string]any{{"document": "sharedbook", "start_time": start, "duration": 30, "page": 1, "pages": 10}}})
		require.Equal(t, 200, r.status, string(r.body))
		cursor(user, start)
	}
	cursor("alice", oldSync+60)
	var matched int
	require.NoError(t, f.db.DB.QueryRow(`SELECT count(*) FROM activity WHERE device_id='physical-reader'`).Scan(&matched))
	require.Equal(t, 2, matched)
}

func TestKOSyncDevicesSnapshotAndAtomicRollback(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	require.Equal(t, 200, f.koWrite("book-a", "reader", 0.8, "opaque original").status)
	old := koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/book-a", nil)
	require.Equal(t, 200, f.call("POST", "/api/v1/me/devices", Device{Id: "reader", Name: "Renamed later"}, nil).status)
	require.Equal(t, string(old.body), string(koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/book-a", nil).body))
	payload := koDevicePayload("anotherbook", "New accepted name")
	payload["device_id"] = "reader"
	require.Equal(t, 200, koDeviceHTTP(t, f, "alice", "PUT", "/api/ko/syncs/progress", payload).status)
	require.Equal(t, string(old.body), string(koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/book-a", nil).body))
	assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", progressPayload("0", 0.1), nil), 409, "progress_conflict")
	f.exec(`CREATE TRIGGER fail_device_snapshot BEFORE INSERT ON reading_head_devices BEGIN SELECT RAISE(ABORT,'snapshot failure'); END`)
	devices, documents := f.count("devices"), f.count("documents")
	payload = koDevicePayload("rollbackplaceholder", "Uncommitted")
	payload["device_id"] = "newreader"
	r := koDeviceHTTP(t, f, "alice", "PUT", "/api/ko/syncs/progress", payload)
	assertKOSyncGolden(t, r, 502, `{"code":2000,"message":"Unknown server error."}`)
	require.Equal(t, devices, f.count("devices"))
	require.Equal(t, documents, f.count("documents"))
	assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", progressPayload("1", 0.2), nil), 500, "storage_error")
	require.Equal(t, 1, f.count("reading_receipts"))
	require.Equal(t, string(old.body), string(koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/book-a", nil).body))
	f.exec("DROP TRIGGER fail_device_snapshot")
	f.exec(`CREATE TRIGGER fail_device_receipt BEFORE INSERT ON reading_receipts BEGIN SELECT RAISE(ABORT,'receipt failure'); END`)
	assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", progressPayload("1", 0.2), nil), 500, "storage_error")
	require.Equal(t, string(old.body), string(koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/book-a", nil).body))
	f.exec("DROP TRIGGER fail_device_receipt")
	require.Equal(t, 200, f.call("POST", "/api/v1/me/reading-progress", progressPayload("1", 0.2), nil).status)
	require.Equal(t, 200, f.call("POST", "/api/v1/me/devices", Device{Id: "web-device", Name: "Browser renamed"}, nil).status)
	r = koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/book-a", nil)
	fields := decodeWeb[map[string]any](t, r)
	require.Equal(t, "Browser", fields["device"])
	require.Equal(t, "web-device", fields["device_id"])
	require.Equal(t, "2", f.state().Revision)
}

func TestKOSyncDevicesMigrationReopenAndDeletion(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	f.exec(`INSERT INTO devices(id,user_id,device_name) VALUES('historical','alice','Only currently known name');
 INSERT INTO reading_heads(user_id,document_id,revision,position,fraction,device_id,updated_at) VALUES('alice','book-a',7,'untouched past',0.12,'historical','2001-02-03T04:05:06Z');
 DROP TABLE auto_import_rules;
 DELETE FROM goose_db_version WHERE version_id>=20261126000000`)
	f.exec(`PRAGMA foreign_keys=OFF; INSERT INTO metadata(document_id,title) VALUES('orphan','Untouched orphan'); PRAGMA foreign_keys=ON`)
	reopen := func() {
		t.Helper()
		f.server.Close()
		require.NoError(t, f.db.DB.Close())
		f.db = database.NewMgr(f.cfg)
		f.start()
	}
	reopen()
	r := koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/book-a", nil)
	require.Equal(t, 200, r.status)
	require.JSONEq(t, `{"document":"book-a","percentage":0.12,"progress":"untouched past","device":"Only currently known name","device_id":"historical","timestamp":981173106}`, string(r.body))
	f.exec(`UPDATE devices SET device_name='Later name' WHERE id='historical'`)
	reopen()
	require.Equal(t, string(r.body), string(koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/book-a", nil).body))
	var revision int
	require.NoError(t, f.db.DB.QueryRow(`SELECT revision FROM reading_heads WHERE user_id='alice' AND document_id='book-a'`).Scan(&revision))
	require.Equal(t, 7, revision)
	require.Equal(t, 1, f.count("metadata"))
	payload := koDevicePayload("persisted", "No ID name")
	require.Equal(t, 200, koDeviceHTTP(t, f, "alice", "PUT", "/api/ko/syncs/progress", payload).status)
	saved := koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/persisted", nil)
	var internal string
	require.NoError(t, f.db.DB.QueryRow(`SELECT id FROM devices WHERE user_id='alice' AND id=''`).Scan(&internal))
	reopen()
	require.Equal(t, string(saved.body), string(koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/persisted", nil).body))
	require.Equal(t, 200, koDeviceHTTP(t, f, "alice", "PUT", "/api/ko/syncs/progress", payload).status)
	var reopenedInternal string
	require.NoError(t, f.db.DB.QueryRow(`SELECT id FROM devices WHERE user_id='alice' AND id=''`).Scan(&reopenedInternal))
	require.Equal(t, internal, reopenedInternal)
	f.exec(`UPDATE documents SET deleted=1 WHERE id='persisted'`)
	require.Equal(t, "{}", string(koDeviceHTTP(t, f, "alice", "GET", "/api/ko/syncs/progress/persisted", nil).body))
	require.Equal(t, 1, f.count("reading_head_devices"))
	f.exec(`DELETE FROM document_progress WHERE document_id='persisted'; DELETE FROM documents WHERE id='persisted'`)
	f.exec(`DELETE FROM users WHERE id='alice'`)
	require.Zero(t, f.count("devices"))
	require.Zero(t, f.count("reading_head_devices"))
	reopen()
	require.Zero(t, f.count("reading_heads"))
	require.Zero(t, f.count("reading_receipts"))
	require.Zero(t, f.count("devices"))
	require.Equal(t, 1, f.count("metadata"))
}
