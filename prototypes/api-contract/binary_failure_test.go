package contract

import (
	"archive/zip"
	"bytes"
	"io"
	"mime/multipart"
	"net/textproto"
	"strings"
	"testing"
)

func archiveFixture(t *testing.T, name string, n int, method uint16) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, entry := range []struct{ name, body string }{{"mimetype", "application/epub+zip"}, {name, strings.Repeat("x", n)}} {
		p, err := w.CreateHeader(&zip.FileHeader{Name: entry.name, Method: method})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = io.WriteString(p, entry.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func TestMultipartExpansionHeadersAndExactLimit(t *testing.T) {
	h := newHarness(t)
	overhead := len(archiveFixture(t, "payload", 0, zip.Store))
	exact := archiveFixture(t, "payload", FileLimit-overhead, zip.Store)
	if len(exact) != FileLimit {
		t.Fatal("fixture is not exact limit")
	}
	for _, tc := range []struct {
		name   string
		data   []byte
		status int
	}{{"exact-file-limit", exact, 200}, {"expansion-limit", archiveFixture(t, "payload", 128*1024+1, zip.Deflate), 413}, {"traversal", archiveFixture(t, "../escape", 1, zip.Store), 400}} {
		t.Run(tc.name, func(t *testing.T) {
			h := h.withTest(t)
			body, media := multipartBody(t, tc.data, "application/epub+zip", false)
			h.call("alice", "POST", "/api/v1/documents/upload", media, body, tc.status, nil)
		})
	}
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="file"; filename="safe.epub"`)
	header.Set("Content-Type", "application/epub+zip")
	header.Set("X-Padding", strings.Repeat("x", WireLimit))
	p, err := w.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	p.Write(h.epub)
	w.Close()
	h.call("alice", "POST", "/api/v1/documents/upload", w.FormDataContentType(), b.Bytes(), 413, nil)
	h.assertCount("documents", 3)
}
