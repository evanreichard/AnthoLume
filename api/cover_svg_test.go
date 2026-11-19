package api

import (
	"bytes"
	"encoding/base64"
	"github.com/stretchr/testify/require"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func requireCoverPolicy(t *testing.T, r webResponse) {
	t.Helper()
	csp := r.header.Get("Content-Security-Policy")
	require.Equal(t, "sandbox", strings.TrimSpace(strings.Split(csp, ";")[0]))
	require.Contains(t, csp, "default-src 'none'")
	require.Contains(t, csp, "img-src data:")
	require.Contains(t, csp, "frame-ancestors 'none'")
	require.Equal(t, "nosniff", r.header.Get("X-Content-Type-Options"))
	require.Equal(t, "private, no-store", r.header.Get("Cache-Control"))
}

func TestCoverServesRealSVGWithInertNavigationPolicy(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	cover := []byte(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>`)
	require.NoError(t, os.WriteFile(filepath.Join(f.cfg.DataPath, "covers", "cover.svg"), cover, 0600))
	f.exec("INSERT INTO documents(id,coverfile) VALUES('svg','cover.svg')")
	var raster bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	require.NoError(t, png.Encode(&raster, img))
	require.NoError(t, os.WriteFile(filepath.Join(f.cfg.DataPath, "covers", "cover.png"), raster.Bytes(), 0600))
	f.exec("INSERT INTO documents(id,coverfile) VALUES('raster','cover.png')")
	headers := map[string]string{"Authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte("alice:password"))}
	for _, item := range []struct {
		id, media string
		body      []byte
	}{{"svg", "image/svg+xml", cover}, {"raster", "image/png", raster.Bytes()}} {
		for _, prefix := range []string{"/api/v1/documents/", "/api/opds/documents/"} {
			path := prefix + item.id + "/cover"
			t.Run(path, func(t *testing.T) {
				r := f.call("GET", path, nil, headers)
				require.Equal(t, 200, r.status, string(r.body))
				require.Equal(t, item.body, r.body)
				require.Contains(t, r.header.Get("Content-Type"), item.media)
				requireCoverPolicy(t, r)
				partial := f.call("GET", path, nil, map[string]string{"Authorization": headers["Authorization"], "Range": "bytes=0-7"})
				require.Equal(t, 206, partial.status, string(partial.body))
				require.Equal(t, item.body[:8], partial.body)
				requireCoverPolicy(t, partial)
				conditional := f.call("GET", path, nil, map[string]string{"Authorization": headers["Authorization"], "If-Modified-Since": r.header.Get("Last-Modified")})
				require.Equal(t, 304, conditional.status, string(conditional.body))
				require.Empty(t, conditional.body)
				requireCoverPolicy(t, conditional)
			})
		}
	}
	fallback, err := os.ReadFile("../assets/images/no-cover.jpg")
	require.NoError(t, err)
	f.exec("INSERT INTO documents(id,coverfile) VALUES('unknown-cover','UNKNOWN'),('missing-cover','gone.svg')")
	for _, id := range []string{"unknown-cover", "missing-cover"} {
		for _, prefix := range []string{"/api/opds/documents/"} {
			r := f.call("GET", prefix+id+"/cover", nil, headers)
			require.Equal(t, 200, r.status)
			require.Equal(t, fallback, r.body)
			require.Contains(t, r.header.Get("Content-Type"), "image/jpeg")
			requireCoverPolicy(t, r)
		}
	}
	require.Zero(t, f.count("metadata"))
}
