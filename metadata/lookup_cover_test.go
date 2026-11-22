package metadata

import (
	"bytes"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

func TestLookupCoverSizePreference(t *testing.T) {
	cover := func(width int) []byte {
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, image.NewGray(image.Rect(0, 0, width, width)), nil); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}
	medium, large := cover(20), cover(80)
	const m, l = "/b/id/42-M.jpg?default=false", "/b/id/42-L.jpg?default=false"
	for _, tc := range []struct {
		name            string
		preferLarge     bool
		largeStatus     int
		largeBody, want []byte
		requests        []string
	}{
		{"preview", false, 200, large, medium, []string{m}},
		{"save large", true, 200, large, large, []string{l}},
		{"missing large", true, 404, nil, medium, []string{l, m}},
		{"invalid large", true, 200, []byte("not a JPEG"), medium, []string{l, m}},
		{"oversized large", true, 200, make([]byte, (2<<20)+1), medium, []string{l, m}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var requests []string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests = append(requests, r.RequestURI)
				if r.RequestURI == l {
					w.WriteHeader(tc.largeStatus)
					w.Write(tc.largeBody)
					return
				}
				w.Write(medium)
			}))
			defer srv.Close()
			got, err := lookupOpenLibraryCover(t.Context(), srv.Client(), srv.URL, 42, tc.preferLarge)
			if err != nil || !bytes.Equal(got, tc.want) || !slices.Equal(requests, tc.requests) {
				t.Fatalf("requests %v, cover size %d, error %v", requests, len(got), err)
			}
		})
	}
}
