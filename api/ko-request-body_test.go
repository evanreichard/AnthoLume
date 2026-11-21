package api

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestKOJSONBodyLimits(t *testing.T) {
	for _, tc := range []struct {
		method, path, payload, table string
		limit, success               int
	}{
		{"POST", "/users/create", `{"username":"new-user","password":"key"}`, "users", koSingleBodyLimit, 201},
		{"PUT", "/syncs/progress", `{"document":"book","device":"reader","progress":"1","percentage":0.1}`, "reading_heads", koSingleBodyLimit, 200},
		{"POST", "/syncs/activity", `{"device_id":"reader","device":"reader"}`, "devices", koSingleBodyLimit, 200},
		{"POST", "/activity", `{"device_id":"reader","device":"reader","activity":[{"document":"book","start_time":1767225600,"duration":20,"page":1,"pages":2}]}`, "activity", koActivityBodyLimit, 200},
		{"POST", "/documents", `{"documents":[{"id":"book","title":"Book"}]}`, "documents", koMetadataBodyLimit, 200},
		{"POST", "/syncs/documents", `{"device_id":"reader","device":"reader","have":[]}`, "devices", koInventoryBodyLimit, 200},
	} {
		t.Run(tc.path, func(t *testing.T) {
			f := newWebFixture(t)
			f.register("alice")
			send := func(size int) *httptest.ResponseRecorder {
				t.Helper()
				body := io.MultiReader(strings.NewReader(tc.payload), strings.NewReader(strings.Repeat(" ", size-len(tc.payload))))
				req := httptest.NewRequest(tc.method, "/api/ko"+tc.path, body)
				require.EqualValues(t, -1, req.ContentLength)
				req.Header.Set("Content-Type", "application/json")
				if tc.path != "/users/create" {
					for k, v := range koHeaders() {
						req.Header.Set(k, v)
					}
				}
				w := httptest.NewRecorder()
				f.api.Handler().ServeHTTP(w, req)
				return w
			}
			before := f.count(tc.table)
			w := send(tc.limit + 1)
			require.Equal(t, 413, w.Code, w.Body.String())
			if tc.path == "/users/create" || tc.path == "/syncs/progress" {
				require.Equal(t, "application/json", w.Header().Get("Content-Type"))
				require.JSONEq(t, `{"code":2000,"message":"Request body too large"}`, w.Body.String())
			} else {
				require.JSONEq(t, `{"error":"Request body too large"}`, w.Body.String())
			}
			require.Equal(t, before, f.count(tc.table))
			w = send(tc.limit)
			require.Equal(t, tc.success, w.Code, w.Body.String())
		})
	}
}
