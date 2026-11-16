package contract

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Fixture KO Adapter - A test-only HTTP shim exercises the shared operation; it is not the production KO wire/auth implementation.
func (h *harness) koHTTP(position string, fraction float64, status int) {
	h.t.Helper()
	type payload struct {
		Document   string  `json:"document"`
		DeviceID   string  `json:"device_id"`
		Percentage float64 `json:"percentage"`
		Progress   string  `json:"progress"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input payload
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, JSONLimit)).Decode(&input); err != nil {
			w.WriteHeader(400)
			return
		}
		if err := h.store.KOWrite(r.Context(), "alice", input.Document, input.DeviceID, input.Progress, input.Percentage); err != nil {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(500)
			json.NewEncoder(w).Encode(problem(500, "storage"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(struct {
			Document string `json:"document"`
		}{input.Document})
	}))
	defer server.Close()
	body, err := json.Marshal(payload{Document: "book-a", DeviceID: "a-second", Percentage: fraction, Progress: position})
	if err != nil {
		h.t.Fatal(err)
	}
	req, err := http.NewRequest("PUT", server.URL+"/fixture/ko-progress", bytes.NewReader(body))
	if err != nil {
		h.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := server.Client().Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		h.t.Fatal(err)
	}
	if res.StatusCode != status {
		h.t.Fatalf("fixture KO HTTP: got %d want %d: %s", res.StatusCode, status, data)
	}
	if status == 200 {
		var result struct {
			Document string `json:"document"`
		}
		if err := json.Unmarshal(data, &result); err != nil || result.Document != "book-a" {
			h.t.Fatalf("bad KO fixture response: %s", data)
		}
	} else {
		if err := validateResponse("POST", "/api/v1/me/reading-progress", res, data); err != nil {
			h.t.Fatal(err)
		}
		var result Problem
		if err := json.Unmarshal(data, &result); err != nil || result.Code != "storage" {
			h.t.Fatalf("bad KO fixture problem: %s", data)
		}
	}
}

func (h *harness) assertKORow(fraction float64, position string) {
	h.t.Helper()
	var actualFraction float64
	var actualPosition string
	if err := h.store.DB.QueryRow("SELECT percentage,progress FROM document_progress WHERE user_id=? AND document_id=? AND device_id=?", "alice", "book-a", "a-second").Scan(&actualFraction, &actualPosition); err != nil {
		h.t.Fatalf("KO device row missing: %v", err)
	}
	if actualFraction != fraction || actualPosition != position {
		h.t.Fatalf("KO device row corrupted: fraction=%g position=%q; want %g %q", actualFraction, actualPosition, fraction, position)
	}
}

func TestKOHTTPWriteAndRollback(t *testing.T) {
	h := newHarness(t)
	h.call("alice", "POST", "/api/v1/me/reading-progress", "application/json", progress("before-ko", "0", .8), 200, nil)
	h.koHTTP("/ko/original.text().4", .1, 200)
	h.assertKORow(.1, "/ko/original.text().4")
	h.assertCount("document_progress", 2)
	h.assertCount("proof_receipts", 1)
	if h.scalar("SELECT revision FROM proof_heads WHERE user_id='alice' AND document_id='book-a'") != 2 {
		t.Fatal("KO did not advance shared head")
	}
	if _, err := h.store.DB.Exec(`CREATE TRIGGER fail_ko_progress BEFORE INSERT ON document_progress WHEN NEW.device_id='a-second' BEGIN SELECT RAISE(ABORT,'injected KO write failure'); END;`); err != nil {
		t.Fatal(err)
	}
	h.koHTTP("/ko/rejected.text().9", .05, 500)
	h.assertKORow(.1, "/ko/original.text().4")
	h.assertCount("document_progress", 2)
	h.assertCount("proof_receipts", 1)
	if h.scalar("SELECT revision FROM proof_heads WHERE user_id='alice' AND document_id='book-a'") != 2 {
		t.Fatal("failed KO legacy write committed head")
	}
	if _, err := h.store.DB.Exec("DROP TRIGGER fail_ko_progress"); err != nil {
		t.Fatal(err)
	}
	h.koHTTP("/ko/retry.text().9", .025, 200)
	h.assertKORow(.025, "/ko/retry.text().9")
	h.assertCount("proof_receipts", 1)
	if h.scalar("SELECT revision FROM proof_heads WHERE user_id='alice' AND document_id='book-a'") != 3 {
		t.Fatal("KO retry did not advance head once")
	}
	conflict := h.call("alice", "POST", "/api/v1/me/reading-progress", "application/json", progress("after-ko-retry", "2", .9), 409, nil)
	var p Problem
	if err := json.Unmarshal(conflict, &p); err != nil || p.Code != "progress_conflict" || p.CurrentRevision == nil || *p.CurrentRevision != "3" {
		t.Fatalf("HTTP conflict lost KO revision: %s", conflict)
	}
}

func TestSignedZeroRetries(t *testing.T) {
	for _, negativeFirst := range []bool{false, true} {
		name := "positive-first"
		if negativeFirst {
			name = "negative-first"
		}
		t.Run(name, func(t *testing.T) {
			h := newHarness(t)
			positive := progress("zero-progress", "0", 0)
			negative := bytes.Replace(positive, []byte(`"fraction":0`), []byte(`"fraction":-0`), 1)
			first, retry := positive, negative
			if negativeFirst {
				first, retry = negative, positive
			}
			accepted := h.call("alice", "POST", "/api/v1/me/reading-progress", "application/json", first, 200, nil)
			replay := h.call("alice", "POST", "/api/v1/me/reading-progress", "application/json", retry, 200, nil)
			if !bytes.Equal(accepted, replay) {
				t.Fatal("signed zero changed progress receipt")
			}
			h.assertCount("document_progress", 1)
			if h.scalar("SELECT revision FROM proof_heads") != 1 {
				t.Fatal("zero retry advanced head")
			}
			for _, field := range []string{"start_fraction", "end_fraction"} {
				t.Run(field, func(t *testing.T) {
					h := h.withTest(t)
					zero := bytes.ReplaceAll(activity("zero-"+field), []byte(`"start_fraction":0.2`), []byte(`"start_fraction":0`))
					zero = bytes.ReplaceAll(zero, []byte(`"end_fraction":0.3`), []byte(`"end_fraction":0`))
					signed := bytes.Replace(zero, []byte(`"`+field+`":0`), []byte(`"`+field+`":-0.0`), 1)
					first, retry := zero, signed
					if negativeFirst {
						first, retry = signed, zero
					}
					accepted := h.call("alice", "POST", "/api/v1/me/activity", "application/json", first, 200, nil)
					replay := h.call("alice", "POST", "/api/v1/me/activity", "application/json", retry, 200, nil)
					if !bytes.Equal(accepted, replay) {
						t.Fatal("signed zero changed activity receipt")
					}
				})
			}
			h.assertCount("activity", 2)
			h.assertCount("proof_receipts", 3)
		})
	}
}
