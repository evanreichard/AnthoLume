package api

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/png"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestWebDocumentManagement(t *testing.T) {
	f := newWebFixture(t)
	f.register("editor")
	f.exec(`INSERT INTO documents(id,title) VALUES('editable','Original')`)
	path := "/api/v1/documents/editable"
	edit := DocumentEdit{Title: "Edited", Author: "New author", Description: "<b>Plain text</b>", Isbn13: "9780765391193"}
	assertProblem(t, f.call("PATCH", path, edit, map[string]string{"Origin": "https://wrong.invalid"}), 403, "csrf_failed")
	assertProblem(t, f.call("PATCH", "/api/v1/documents/missing", edit, nil), 404, "not_found")
	var img bytes.Buffer
	require.NoError(t, png.Encode(&img, image.NewRGBA(image.Rect(0, 0, 3, 3))))
	broken := base64.StdEncoding.EncodeToString([]byte("not an image"))
	edit.CoverBase64 = &broken
	assertProblem(t, f.call("PATCH", path, edit, nil), 400, "invalid_request")
	require.Equal(t, "Original", *decodeWeb[Document](t, f.call("GET", path, nil, nil)).Title)
	cover := base64.StdEncoding.EncodeToString(img.Bytes())
	edit.CoverBase64 = &cover
	r := f.call("PATCH", path, edit, nil)
	require.Equal(t, 200, r.status, string(r.body))
	doc := decodeWeb[Document](t, r)
	require.Equal(t, "Edited", *doc.Title)
	require.Equal(t, edit.Description, *doc.Description)
	require.Equal(t, edit.Isbn13, *doc.Isbn13)
	r = f.call("GET", path+"/cover", nil, nil)
	require.Equal(t, 200, r.status)
	require.Equal(t, img.Bytes(), r.body)
	remove := true
	edit.CoverBase64 = nil
	edit.RemoveCover = &remove
	r = f.call("PATCH", path, edit, nil)
	require.Equal(t, 200, r.status, string(r.body))
	require.False(t, decodeWeb[Document](t, r).CoverAvailable)
	assertProblem(t, f.call("DELETE", path, nil, map[string]string{"X-CSRF-Token": "bad"}), 403, "csrf_failed")
	for range 2 {
		r = f.call("DELETE", path, nil, nil)
		require.Equal(t, 204, r.status, string(r.body))
	}
	assertProblem(t, f.call("GET", path, nil, nil), 404, "not_found")
	assertProblem(t, f.call("PATCH", path, edit, nil), 404, "not_found")
	var deleted bool
	require.NoError(t, f.db.DB.QueryRow("SELECT deleted FROM documents WHERE id='editable'").Scan(&deleted))
	require.True(t, deleted)
}
