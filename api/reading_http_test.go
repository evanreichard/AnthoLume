package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/database"
)

func (f *webFixture) koWrite(document, device string, fraction float64, position string) webResponse {
	return f.call("PUT", "/api/ko/syncs/progress", map[string]any{"document": document, "device_id": device, "device": "KOReader", "percentage": fraction, "progress": position}, koHeaders())
}
func (f *webFixture) state() ReadingState {
	r := f.call("GET", "/api/v1/me/reading-state/book-a", nil, nil)
	require.Equal(f.t, 200, r.status, string(r.body))
	return decodeWeb[ReadingState](f.t, r)
}
func TestRealKOAndWebSharedHead(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	empty := f.state()
	require.Equal(t, "0", empty.Revision)
	require.Nil(t, empty.Position)
	require.Nil(t, empty.Fraction)
	require.Nil(t, empty.DeviceId)
	require.Nil(t, empty.UpdatedAt)
	// Force the real MD5 header path instead of borrowing the browser's signed session.
	jar := f.client.Jar
	f.client.Jar = nil
	r := f.call("GET", "/api/ko/syncs/progress/book-a", nil, koHeaders())
	require.Equal(t, 200, r.status)
	require.JSONEq(t, `{}`, string(r.body))
	require.Equal(t, "application/json", r.header.Get("Content-Type"))
	r = f.koWrite("book-a", "ko-device", 0.8, "exact KO /body/p[9].0")
	require.Equal(t, 200, r.status, string(r.body))
	timestamp := decodeKOTimestamp(t, r)
	require.Equal(t, "book-a", decodeWeb[map[string]any](t, r)["document"])
	r = f.call("GET", "/api/ko/syncs/progress/book-a", nil, koHeaders())
	require.Equal(t, 200, r.status)
	require.JSONEq(t, fmt.Sprintf(`{"document":"book-a","percentage":0.8,"progress":"exact KO /body/p[9].0","device":"KOReader","device_id":"ko-device","timestamp":%d}`, timestamp), string(r.body))
	f.client.Jar = jar
	head := f.state()
	require.Equal(t, "1", head.Revision)
	require.Equal(t, head.UpdatedAt.Unix(), timestamp)
	stale := progressPayload("0", 0.2)
	r = f.call("POST", "/api/v1/me/reading-progress", stale, nil)
	assertProblem(t, r, 409, "progress_conflict")
	require.Equal(t, "1", *decodeWeb[Problem](t, r).CurrentRevision)
	accepted := progressPayload("1", 0.1)
	accepted["position"] = "backwards exactly"
	r = f.call("POST", "/api/v1/me/reading-progress", accepted, nil)
	require.Equal(t, 200, r.status, string(r.body))
	receipt := decodeWeb[Receipt](t, r)
	require.Equal(t, accepted["event_id"], receipt.EventId)
	require.Equal(t, Progress, receipt.Kind)
	require.Equal(t, "2", *receipt.Revision)
	r = f.call("GET", "/api/ko/syncs/progress/book-a", nil, nil)
	require.JSONEq(t, fmt.Sprintf(`{"document":"book-a","percentage":0.1,"progress":"backwards exactly","device":"Browser","device_id":"web-device","timestamp":%d}`, f.state().UpdatedAt.Unix()), string(r.body))
	require.Equal(t, 200, f.koWrite("placeholder", "ko-device", 0.4, "placeholder position").status)
	require.Equal(t, 3, f.count("documents"))
	require.Equal(t, 2, f.count("reading_heads"))
}

func TestDurableReceiptsNormalizationAndConflicts(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	event := progressPayload("0", 0)
	r := f.call("POST", "/api/v1/me/reading-progress", event, nil)
	require.Equal(t, 200, r.status, string(r.body))
	original := string(r.body)
	// Equivalent UTC instants and signed zero have one normalized identity.
	event["observed_at"] = "2026-01-01T13:00:00+01:00"
	encoded, err := json.Marshal(event)
	require.NoError(t, err)
	encoded = bytes.Replace(encoded, []byte(`"fraction":0`), []byte(`"fraction":-0`), 1)
	r = f.call("POST", "/api/v1/me/reading-progress", string(encoded), nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.JSONEq(t, original, string(r.body))
	require.Equal(t, 200, f.koWrite("book-a", "ko", 0.9, "KO forward").status)
	conflict := progressPayload("1", 0.3)
	r = f.call("POST", "/api/v1/me/reading-progress", conflict, nil)
	assertProblem(t, r, 409, "progress_conflict")
	require.Equal(t, "2", *decodeWeb[Problem](t, r).CurrentRevision)
	require.Equal(t, 200, f.koWrite("book-a", "ko", 0.7, "KO again").status)
	r = f.call("POST", "/api/v1/me/reading-progress", conflict, nil)
	require.Equal(t, "2", *decodeWeb[Problem](t, r).CurrentRevision)
	event["fraction"] = 0.2
	assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", event, nil), 409, "idempotency_conflict")
	activity := activityPayload()
	activity["event_id"] = event["event_id"]
	assertProblem(t, f.call("POST", "/api/v1/me/activity", activity, nil), 409, "idempotency_conflict")
	activity["event_id"] = activityPayload()["event_id"]
	activity["start_fraction"] = 0
	activity["end_fraction"] = 0
	r = f.call("POST", "/api/v1/me/activity", activity, nil)
	require.Equal(t, 200, r.status, string(r.body))
	ack := decodeWeb[Receipt](t, r)
	require.Equal(t, activity["event_id"], ack.EventId)
	require.Equal(t, Activity, ack.Kind)
	require.Nil(t, ack.Revision)
	activity["start_time"] = "2026-01-01T07:00:00-05:00"
	encoded, err = json.Marshal(activity)
	require.NoError(t, err)
	encoded = bytes.ReplaceAll(encoded, []byte(`_fraction":0`), []byte(`_fraction":-0`))
	require.Equal(t, 200, f.call("POST", "/api/v1/me/activity", string(encoded), nil).status)
	require.Equal(t, 1, f.count("activity"))
	require.Equal(t, "3", f.state().Revision)
	var payload, observed string
	var version int
	require.NoError(t, f.db.DB.QueryRow("SELECT payload,payload_version,observed_at FROM reading_receipts WHERE event_id=?", activity["event_id"]).Scan(&payload, &version, &observed))
	require.Equal(t, 1, version)
	require.Contains(t, payload, `"start_fraction":0`)
	require.Equal(t, "2026-01-01T12:00:00Z", observed)
}
func TestReadingAtomicRollbackAndConcurrentCAS(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	f.exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON reading_receipts BEGIN SELECT RAISE(ABORT,'private database detail'); END`)
	event := progressPayload("0", 0.5)
	assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", event, nil), 500, "storage_error")
	activity := activityPayload()
	assertProblem(t, f.call("POST", "/api/v1/me/activity", activity, nil), 500, "storage_error")
	require.Zero(t, f.count("reading_heads"))
	require.Zero(t, f.count("reading_receipts"))
	require.Zero(t, f.count("document_progress"))
	require.Zero(t, f.count("activity"))
	f.exec("DROP TRIGGER fail_receipt")
	f.exec(`CREATE TRIGGER fail_progress BEFORE INSERT ON document_progress BEGIN SELECT RAISE(ABORT,'private path'); END`)
	r := f.koWrite("new-placeholder", "new-device", 0.4, "position")
	assertKOSyncGolden(t, r, 502, `{"code":2000,"message":"Unknown server error."}`)
	require.Equal(t, 2, f.count("documents"))
	require.Equal(t, 1, f.count("devices"))
	require.Zero(t, f.count("reading_heads"))
	assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", event, nil), 500, "storage_error")
	require.Zero(t, f.count("reading_receipts"))
	f.exec("DROP TRIGGER fail_progress")
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses <- f.call("POST", "/api/v1/me/reading-progress", progressPayload("0", 0.5), nil).status
		}()
	}
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	require.Equal(t, map[int]int{200: 1, 409: 1}, counts)
	require.Equal(t, 1, f.count("document_progress"))
	require.Equal(t, 2, f.count("reading_receipts"))
	require.Equal(t, "1", f.state().Revision)
	activity = activityPayload()
	statuses = make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); statuses <- f.call("POST", "/api/v1/me/activity", activity, nil).status }()
	}
	wg.Wait()
	close(statuses)
	for status := range statuses {
		require.Equal(t, 200, status)
	}
	require.Equal(t, 1, f.count("activity"))
}
func TestLostCommittedResponseReopenAndDeviceOwnership(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	event := progressPayload("0", 0.4)
	activity := activityPayload()
	for path, payload := range map[string]any{"/api/v1/me/reading-progress": event, "/api/v1/me/activity": activity} {
		data, err := json.Marshal(payload)
		require.NoError(t, err)
		request, err := http.NewRequest("POST", f.server.URL+path, bytes.NewReader(data))
		require.NoError(t, err)
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Origin", f.cfg.PublicOrigin)
		request.Header.Set("X-CSRF-Token", f.csrf)
		request.Header.Set("X-AnthoLume-Reading-Generation", f.generation)
		request.Header.Set("X-Test-Drop-Response", "yes")
		response, err := f.client.Do(request)
		if response != nil {
			io.Copy(io.Discard, response.Body)
			response.Body.Close()
		}
		require.Error(t, err)
	}
	require.Equal(t, 1, f.count("activity"))
	require.Equal(t, 2, f.count("reading_receipts"))
	f.server.Close()
	require.NoError(t, f.db.DB.Close())
	f.db = database.NewMgr(f.cfg)
	f.start()
	require.Equal(t, 200, f.call("POST", "/api/v1/me/reading-progress", event, nil).status)
	require.Equal(t, 200, f.call("POST", "/api/v1/me/activity", activity, nil).status)
	require.Equal(t, "1", f.state().Revision)
	require.Equal(t, 1, f.count("activity"))
	// Web ownership remains global; KOSync translates the same external ID without taking the original device.
	f.call("POST", "/api/v1/session/logout", map[string]any{}, nil)
	f.register("bob")
	assertProblem(t, f.call("POST", "/api/v1/me/devices", Device{Id: "web-device", Name: "Hijack"}, nil), 409, "device_conflict")
	r := f.call("PUT", "/api/ko/syncs/progress", map[string]any{"document": "collision-placeholder", "device_id": "web-device", "device": "Hijack", "percentage": 0.2, "progress": "x"}, nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.Equal(t, 3, f.count("documents"))
	var owner, name string
	require.NoError(t, f.db.DB.QueryRow("SELECT user_id,device_name FROM devices WHERE id='web-device'").Scan(&owner, &name))
	require.Equal(t, "alice", owner)
	require.Equal(t, "Browser", name)
	fresh := progressPayload("0", 0.3)
	assertProblem(t, f.call("POST", "/api/v1/me/reading-progress", fresh, nil), 409, "device_conflict")
	require.Equal(t, 2, f.count("reading_receipts"))
}
func TestKOActivityCreditAndOwnerRollback(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	payload := `{"device_id":"ko-device","device":"KOReader","activity":[{"document":"placeholder","start_time":1767225600,"duration":20,"page":2,"pages":10}]}`
	r := f.call("POST", "/api/ko/activity", payload, nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.JSONEq(t, `{"added":1}`, string(r.body))
	var start, end float64
	require.NoError(t, f.db.DB.QueryRow("SELECT start_percentage,end_percentage FROM activity").Scan(&start, &end))
	require.Equal(t, 0.2, start)
	require.Equal(t, 0.3, end)
	r = f.call("POST", "/api/ko/syncs/activity", `{"device_id":"ko-device","device":"KOReader"}`, nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.JSONEq(t, `{"last_sync":1767225600}`, string(r.body))
	r = f.call("POST", "/api/ko/activity", strings.Replace(payload, `"pages":10`, `"pages":0`, 1), nil)
	require.Equal(t, 400, r.status)
	require.Equal(t, 1, f.count("activity"))
	require.Zero(t, f.count("reading_receipts"))
}

func TestSyncNinjaDeletedBookActivityAdvancesCursor(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	f.exec(`INSERT INTO documents(id,deleted) VALUES('deleted-book',1),('live-book',0)`)
	const check = `{"device_id":"ko-device","device":"KOReader"}`
	cursor := func(want int64) {
		t.Helper()
		r := f.call("POST", "/api/ko/syncs/activity", check, nil)
		require.Equal(t, 200, r.status, string(r.body))
		require.Equal(t, want, decodeWeb[struct {
			LastSync int64 `json:"last_sync"`
		}](t, r).LastSync)
	}
	cursor(0)
	r := f.call("POST", "/api/ko/activity", `{"device_id":"ko-device","device":"KOReader","activity":[
		{"document":"deleted-book","start_time":1767225660,"duration":30,"page":2,"pages":10},
		{"document":"live-book","start_time":1767225600,"duration":20,"page":3,"pages":10}]}`, nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.JSONEq(t, `{"added":2}`, string(r.body))
	cursor(1767225660)
	assertProblem(t, f.call("GET", "/api/v1/documents/deleted-book", nil, nil), 404, "not_found")

	r = f.call("POST", "/api/ko/activity", `{"device_id":"ko-device","device":"KOReader","activity":[
		{"document":"live-book","start_time":1767225720,"duration":20,"page":4,"pages":10}]}`, nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.JSONEq(t, `{"added":1}`, string(r.body))
	cursor(1767225720)
	require.Equal(t, 3, f.count("activity"))
}
