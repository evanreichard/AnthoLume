package contract

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"testing"
)

func TestUploadCRCIntegrity(t *testing.T) {
	h := newHarness(t)
	archive, err := zip.NewReader(bytes.NewReader(h.epub), int64(len(h.epub)))
	if err != nil {
		t.Fatal(err)
	}
	corrupt := append([]byte(nil), h.epub...)
	found := false
	for _, file := range archive.File {
		if file.Name != "chapter.xhtml" {
			continue
		}
		offset, err := file.DataOffset()
		if err != nil {
			t.Fatal(err)
		}
		corrupt[offset+8] ^= 1
		found = true
	}
	if !found {
		t.Fatal("missing corruption target")
	}
	archive, err = zip.NewReader(bytes.NewReader(corrupt), int64(len(corrupt)))
	if err != nil {
		t.Fatal("fixture must remain a parseable ZIP:", err)
	}
	checked := false
	for _, file := range archive.File {
		if file.Name != "chapter.xhtml" {
			continue
		}
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		_, err = io.ReadAll(reader)
		reader.Close()
		if !errors.Is(err, zip.ErrChecksum) {
			t.Fatalf("fixture must fail CRC, got %v", err)
		}
		checked = true
	}
	if !checked {
		t.Fatal("missing CRC check")
	}
	body, media := multipartBody(t, corrupt, "application/epub+zip", false)
	response := h.call("alice", "POST", "/api/v1/documents/upload", media, body, 400, nil)
	var p Problem
	if err := json.Unmarshal(response, &p); err != nil || p.Code != "invalid_epub" {
		t.Fatalf("wrong CRC error: %s", response)
	}
	h.assertCount("documents", 3)
}
