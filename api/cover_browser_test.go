package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestCoverBrowserIsolation(t *testing.T) {
	if os.Getenv("ANTHOLUME_COVER_BROWSER") != "1" {
		t.Skip("run bash api/check-cover-browser.sh for required Chromium cover qualification")
	}
	f := newWebFixture(t)
	var externalRequests, credentialRequests, sessionRequests atomic.Int32
	f.server.Close()
	f.server = httptest.NewUnstartedServer(nil)
	f.cfg.PublicOrigin = "http://" + f.server.Listener.Addr().String()
	var err error
	f.api, err = NewAPI(f.db, f.cfg, os.DirFS(".."))
	require.NoError(t, err)
	f.server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/session" && (r.Header.Get("X-Cover-Qualification") == "1" || r.URL.Query().Has("cover-resource")) {
			sessionRequests.Add(1)
		}
		f.api.Handler().ServeHTTP(w, r)
	})
	f.server.Start()
	probe := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		externalRequests.Add(1)
		if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			credentialRequests.Add(1)
		}
		w.Header().Set("Content-Type", "image/svg+xml")
		_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`))
	}))
	defer probe.Close()
	svg := []byte(fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="40" viewBox="0 0 40 40"><style>@import url('%[1]s/import.css'); @font-face{font-family:probe;src:url('%[1]s/font.woff2')} .probe{font-family:probe;fill:url('%[1]s/paint.svg#x')}</style><defs><rect id="background" width="40" height="40" fill="#e00000"/></defs><use href="#background"/><image href="%[2]s/api/v1/session?cover-resource=1" width="1" height="1"/><image href="%[1]s/image.svg" width="1" height="1"/><use xlink:href="%[1]s/use.svg#x"/><text class="probe" x="39" y="39">x</text><script><![CDATA[document.documentElement.setAttribute('data-cover-executed','yes');try{parent.document.documentElement.setAttribute('data-cover-parent','accessible')}catch{}fetch('/api/v1/session').then(r=>r.json()).then(s=>{document.documentElement.setAttribute('data-cover-user',s.user?.id||'anonymous');document.documentElement.setAttribute('data-cover-csrf',typeof s.csrf_token==='string'?'readable':'missing');parent.postMessage({bookCover:true,user:s.user?.id,csrf:typeof s.csrf_token==='string'},'*')});]]></script></svg>`, probe.URL, f.server.URL))
	require.NoError(t, os.WriteFile(filepath.Join(f.cfg.DataPath, "covers", "browser.svg"), svg, 0600))
	var raster bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 2; x++ {
			img.Set(x, y, color.RGBA{G: 96, B: 208, A: 255})
		}
	}
	require.NoError(t, png.Encode(&raster, img))
	require.NoError(t, os.WriteFile(filepath.Join(f.cfg.DataPath, "covers", "browser.png"), raster.Bytes(), 0600))
	f.exec("INSERT INTO documents(id,coverfile) VALUES('browser-svg','browser.svg'),('browser-raster','browser.png')")
	output := t.TempDir()
	if base := os.Getenv("ANTHOLUME_COVER_EVIDENCE"); base != "" {
		require.NoError(t, os.MkdirAll(base, 0700))
		var err error
		output, err = os.MkdirTemp(base, "run.")
		require.NoError(t, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "node", "cover-browser.mjs", f.server.URL, output)
	cwd, err := os.Getwd()
	require.NoError(t, err)
	relativeTemp, err := filepath.Rel(cwd, os.TempDir())
	require.NoError(t, err)
	// Socket Length - Chromium's Unix singleton socket exceeds sun_path when this checkout's absolute scratch path is used.
	command.Env = append(os.Environ(), "TMPDIR="+relativeTemp)
	result, err := command.CombinedOutput()
	t.Logf("cover resource probe: %d session requests, %d external requests, %d carrying external credentials", sessionRequests.Load(), externalRequests.Load(), credentialRequests.Load())
	require.NoError(t, err, string(result))
	var summary struct {
		Browser              string `json:"browser"`
		Checks               int    `json:"checks"`
		SessionRequestEvents int    `json:"sessionRequestEvents"`
	}
	require.NoError(t, json.Unmarshal(bytes.TrimSpace(result), &summary), string(result))
	require.NotEmpty(t, summary.Browser)
	require.Equal(t, 18, summary.Checks)
	require.Zero(t, sessionRequests.Load(), "a cover fetched session/CSRF data")
	require.Zero(t, externalRequests.Load(), "SVG attempted an external resource request")
	require.Zero(t, credentialRequests.Load(), "SVG sent session/Basic credentials to an external origin")
	for i := 0; i < 3; i++ {
		for _, kind := range []string{"svg-top", "svg-img", "raster-img"} {
			file, err := os.Open(filepath.Join(output, fmt.Sprintf("%s-%d.png", kind, i)))
			require.NoError(t, err)
			rendered, err := png.Decode(file)
			file.Close()
			require.NoError(t, err)
			bounds := rendered.Bounds()
			r, g, b, _ := rendered.At(bounds.Min.X+bounds.Dx()/2, bounds.Min.Y+bounds.Dy()/2).RGBA()
			if kind == "raster-img" {
				require.Equal(t, uint32(0), r)
				require.Equal(t, uint32(96*257), g)
				require.Equal(t, uint32(208*257), b)
			} else {
				require.Equal(t, uint32(224*257), r)
				require.Zero(t, g)
				require.Zero(t, b)
			}
		}
	}
	t.Logf("Chromium %s: %d real-HTTP top/image/embed checks; visible SVG/raster pixels and zero session/external resource requests", summary.Browser, summary.Checks)
}
