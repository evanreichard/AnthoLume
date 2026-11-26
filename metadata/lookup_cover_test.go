package metadata

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"reichard.io/antholume/matcherquota"
)

func TestLookupCoverErrors(t *testing.T) {
	var cover bytes.Buffer
	if err := jpeg.Encode(&cover, image.NewGray(image.Rect(0, 0, 20, 20)), nil); err != nil {
		t.Fatal(err)
	}
	truncated := cover.Bytes()[:cover.Len()-2]
	if _, err := jpeg.DecodeConfig(bytes.NewReader(truncated)); err != nil {
		t.Fatal("truncation should pass JPEG header validation", err)
	}
	for _, tc := range []struct {
		name   string
		status int
		body   []byte
		want   error
	}{
		{"medium rate limited", http.StatusTooManyRequests, nil, matcherquota.ErrLimited},
		{"gone", http.StatusGone, nil, ErrLookupCoverMissing},
		{"oversized medium", http.StatusOK, make([]byte, (2<<20)+1), ErrLookupCoverMissing},
		{"truncated medium", http.StatusOK, truncated, ErrLookupCoverMissing},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write(tc.body)
			}))
			defer srv.Close()
			got, err := lookupOpenLibraryCover(t.Context(), srv.Client(), srv.URL, 42, false)
			if got != nil || !errors.Is(err, tc.want) {
				t.Fatalf("got %d bytes and %v, want no cover and %v", len(got), err, tc.want)
			}
		})
	}
}

func TestLookupCoverCancellationDoesNotFallBack(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/b/id/42-L.jpg" {
			t.Error("a canceled cover lookup must not fall back to medium")
		}
		cancel()
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	got, err := lookupOpenLibraryCover(ctx, srv.Client(), srv.URL, 42, true)
	if got != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("got %d bytes and %v, want no cover and cancellation", len(got), err)
	}
}

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
		wantErr         error
	}{
		{"preview", false, 200, large, medium, []string{m}, nil},
		{"save large", true, 200, large, large, []string{l}, nil},
		{"missing large", true, 404, nil, medium, []string{l, m}, nil},
		{"invalid large", true, 200, []byte("not a JPEG"), medium, []string{l, m}, nil},
		{"oversized large", true, 200, make([]byte, (2<<20)+1), medium, []string{l, m}, nil},
		{"large rate limited", true, 429, nil, nil, []string{l}, matcherquota.ErrLimited},
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
			if !errors.Is(err, tc.wantErr) || !bytes.Equal(got, tc.want) || !slices.Equal(requests, tc.requests) {
				t.Fatalf("requests %v, cover size %d, error %v", requests, len(got), err)
			}
		})
	}
}
