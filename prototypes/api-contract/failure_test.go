package contract

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestActivityReceiptDedup(t *testing.T) {
	h := newHarness(t)
	first := h.call("alice", "POST", "/api/v1/me/activity", "application/json", activity("dedup"), 200, nil)
	var receipt Receipt
	if err := json.Unmarshal(first, &receipt); err != nil || receipt.EventId != "dedup" || receipt.Kind != Activity || receipt.Revision != nil {
		t.Fatalf("wrong activity receipt semantics: %s", first)
	}
	for range 3 {
		if replay := h.call("alice", "POST", "/api/v1/me/activity", "application/json", activity("dedup"), 200, nil); !bytes.Equal(first, replay) {
			t.Fatal("changed acknowledgement")
		}
	}
	h.assertCount("activity", 1)
	h.assertCount("proof_receipts", 1)
	if h.scalar("SELECT sum(duration) FROM activity") != 30 {
		t.Fatal("duplicate credit")
	}
}

func TestCanceledStrictOperation(t *testing.T) {
	h := newHarness(t)
	ctx, cancel := context.WithCancel(context.WithValue(context.Background(), principalKey{}, principal{user: "alice"}))
	cancel()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/api/v1/me/reading-progress", nil).WithContext(ctx)
	var e ProgressEvent
	if err := json.Unmarshal(progress("canceled", "0", .4), &e); err != nil {
		t.Fatal(err)
	}
	server := &Server{store: h.store, epub: h.epub}
	if _, err := server.SubmitProgress(c, SubmitProgressRequestObject{Body: &e}); !errors.Is(err, context.Canceled) {
		t.Fatalf("lost underlying cancellation: %v", err)
	}
	h.assertCount("proof_receipts", 0)
	h.assertCount("document_progress", 0)
}

func TestChunkedBodyLimit(t *testing.T) {
	h := newHarness(t)
	body := append(bytes.Repeat([]byte(" "), JSONLimit), progress("chunked", "0", .3)...)
	req, err := http.NewRequest("POST", h.server.URL+"/api/v1/me/reading-progress", io.NopCloser(bytes.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", proofOrigin)
	req.Header.Set("X-CSRF-Token", "csrf-alice")
	req.AddCookie(h.cookies["alice"])
	req.TransferEncoding = []string{"chunked"}
	req.ContentLength = -1
	res, err := h.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 413 {
		t.Fatalf("chunked limit bypass: %d %s", res.StatusCode, b)
	}
	if err = validateResponse("POST", "/api/v1/me/reading-progress", res, b); err != nil {
		t.Fatal(err)
	}
	h.assertCount("proof_receipts", 0)
}
