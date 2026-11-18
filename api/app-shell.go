package api

import (
	"fmt"
	"io/fs"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

var appNavigation = regexp.MustCompile(`^/(?:|library/?|offline/?|login/?|register/?|settings/?|more/?|sync/?|insights(?:/(?:activity|progress|rankings))?/?|(?:books|read)/(?:local|server)/[^/]+/?)$`)
var hashedAsset = regexp.MustCompile(`-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$`)

func CheckAppAssets(assets fs.FS) error {
	for _, name := range []string{"assets/app/index.html", "assets/app/sw.js", "assets/app/manifest.json"} {
		info, err := fs.Stat(assets, name)
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return fmt.Errorf("compiled application missing; run npm --prefix web ci and npm --prefix web run build")
		}
	}
	return nil
}
func (api *API) appShell(c *gin.Context) {
	if !appNavigation.MatchString(c.Param("route")) && !appNavigation.MatchString(strings.TrimPrefix(c.Request.URL.EscapedPath(), "/app")) {
		c.Status(404)
		return
	}
	api.serveAppShell(c)
}
func (api *API) serveAppShell(c *gin.Context) {
	b, err := fs.ReadFile(api.assets, "assets/app/index.html")
	if err != nil {
		c.Header("Retry-After", "60")
		c.String(503, "Application build unavailable")
		return
	}
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
	c.Data(200, "text/html; charset=utf-8", b)
}
func (api *API) retirementBootstrap(c *gin.Context) {
	if c.Request.URL.Path == "/" && c.Query("antholume-retirement") == "legacy-v1" {
		api.serveAppShell(c)
		c.Abort()
		return
	}
	c.Next()
}
func (api *API) appAssetPolicy(c *gin.Context) {
	p := c.Request.URL.Path
	if strings.HasPrefix(p, "/assets/app/") {
		if !strings.HasPrefix(p, "/assets/app/assets/") {
			c.AbortWithStatus(404)
			return
		}
		info, err := fs.Stat(api.assets, strings.TrimPrefix(p, "/"))
		if err != nil || !info.Mode().IsRegular() {
			c.AbortWithStatus(404)
			return
		}
		c.Header("Cache-Control", "no-cache")
		if hashedAsset.MatchString(p) {
			c.Header("Cache-Control", "public, max-age=31536000, immutable")
		}
		c.Header("X-Content-Type-Options", "nosniff")
	}
	c.Next()
}
func (api *API) compiledOrLegacy(c *gin.Context, name, media string) {
	source := "assets/app/" + name
	if _, err := fs.Stat(api.assets, source); err != nil {
		source = "assets/" + name
	}
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Type", media)
	c.FileFromFS(source, http.FS(api.assets))
}
