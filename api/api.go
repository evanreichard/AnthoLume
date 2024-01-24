package api

import (
	"crypto/rand"
	"embed"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-contrib/multitemplate"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/microcosm-cc/bluemonday"
	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

type API struct {
	Router     *gin.Engine
	Config     *config.Config
	DB         *database.DBManager
	HTMLPolicy *bluemonday.Policy
	Assets     *embed.FS
	Templates  map[string]*template.Template
}

func NewApi(db *database.DBManager, c *config.Config, assets *embed.FS) *API {
	api := &API{
		HTMLPolicy: bluemonday.StrictPolicy(),
		Router:     gin.New(),
		Config:     c,
		DB:         db,
		Assets:     assets,
	}

	// Add Logger
	api.Router.Use(apiLogger())

	// Assets & Web App Templates
	assetsDir, _ := fs.Sub(assets, "assets")
	api.Router.StaticFS("/assets", http.FS(assetsDir))

	// Generate Secure Token
	var newToken []byte
	var err error

	if c.CookieSessionKey != "" {
		log.Info("[NewApi] Utilizing Environment Cookie Session Key")
		newToken = []byte(c.CookieSessionKey)
	} else {
		log.Info("[NewApi] Generating Cookie Session Key")
		newToken, err = generateToken(64)
		if err != nil {
			panic("Unable to generate secure token")
		}
	}

	// Configure Cookie Session Store
	store := cookie.NewStore(newToken)
	store.Options(sessions.Options{
		MaxAge:   60 * 60 * 24 * 7,
		Secure:   c.CookieSecure,
		HttpOnly: c.CookieHTTPOnly,
		SameSite: http.SameSiteStrictMode,
	})
	api.Router.Use(sessions.Sessions("token", store))

	// Register Web App Route
	api.registerWebAppRoutes()

	// Register API Routes
	apiGroup := api.Router.Group("/api")
	api.registerKOAPIRoutes(apiGroup)
	api.registerOPDSRoutes(apiGroup)

	return api
}

func (api *API) registerWebAppRoutes() {
	// Generate Templates
	api.Router.HTMLRender = *api.generateTemplates()

	// Static Assets (Required @ Root)
	api.Router.GET("/manifest.json", api.appWebManifest)
	api.Router.GET("/favicon.ico", api.appFaviconIcon)
	api.Router.GET("/sw.js", api.appServiceWorker)

	// Local / Offline Static Pages (No Template, No Auth)
	api.Router.GET("/local", api.appLocalDocuments)

	// Reader (Reader Page, Document Progress, Devices)
	api.Router.GET("/reader", api.appDocumentReader)
	api.Router.GET("/reader/devices", api.authWebAppMiddleware, api.appGetDevices)
	api.Router.GET("/reader/progress/:document", api.authWebAppMiddleware, api.appGetDocumentProgress)

	// Web App
	api.Router.GET("/", api.authWebAppMiddleware, api.appGetHome)
	api.Router.GET("/activity", api.authWebAppMiddleware, api.appGetActivity)
	api.Router.GET("/progress", api.authWebAppMiddleware, api.appGetProgress)
	api.Router.GET("/documents", api.authWebAppMiddleware, api.appGetDocuments)
	api.Router.GET("/documents/:document", api.authWebAppMiddleware, api.appGetDocument)
	api.Router.GET("/documents/:document/cover", api.authWebAppMiddleware, api.getDocumentCover)
	api.Router.GET("/documents/:document/file", api.authWebAppMiddleware, api.downloadDocument)
	api.Router.GET("/login", api.appGetLogin)
	api.Router.GET("/logout", api.authWebAppMiddleware, api.appAuthLogout)
	api.Router.GET("/register", api.appGetRegister)
	api.Router.GET("/settings", api.authWebAppMiddleware, api.appGetSettings)
	api.Router.GET("/admin/logs", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appGetAdminLogs)
	api.Router.GET("/admin/users", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appGetAdminUsers)
	api.Router.GET("/admin", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appGetAdmin)
	api.Router.POST("/admin", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appPerformAdminAction)
	api.Router.POST("/login", api.appAuthFormLogin)
	api.Router.POST("/register", api.appAuthFormRegister)

	// Demo Mode Enabled Configuration
	if api.Config.DemoMode {
		api.Router.POST("/documents", api.authWebAppMiddleware, api.appDemoModeError)
		api.Router.POST("/documents/:document/delete", api.authWebAppMiddleware, api.appDemoModeError)
		api.Router.POST("/documents/:document/edit", api.authWebAppMiddleware, api.appDemoModeError)
		api.Router.POST("/documents/:document/identify", api.authWebAppMiddleware, api.appDemoModeError)
		api.Router.POST("/settings", api.authWebAppMiddleware, api.appDemoModeError)
	} else {
		api.Router.POST("/documents", api.authWebAppMiddleware, api.appUploadNewDocument)
		api.Router.POST("/documents/:document/delete", api.authWebAppMiddleware, api.appDeleteDocument)
		api.Router.POST("/documents/:document/edit", api.authWebAppMiddleware, api.appEditDocument)
		api.Router.POST("/documents/:document/identify", api.authWebAppMiddleware, api.appIdentifyDocument)
		api.Router.POST("/settings", api.authWebAppMiddleware, api.appEditSettings)
	}

	// Search Enabled Configuration
	if api.Config.SearchEnabled {
		api.Router.GET("/search", api.authWebAppMiddleware, api.appGetSearch)
		api.Router.POST("/search", api.authWebAppMiddleware, api.appSaveNewDocument)
	}
}

func (api *API) registerKOAPIRoutes(apiGroup *gin.RouterGroup) {
	koGroup := apiGroup.Group("/ko")

	// KO Sync Routes (WebApp Uses - Progress & Activity)
	koGroup.GET("/documents/:document/file", api.authKOMiddleware, api.downloadDocument)
	koGroup.GET("/syncs/progress/:document", api.authKOMiddleware, api.koGetProgress)
	koGroup.GET("/users/auth", api.authKOMiddleware, api.koAuthorizeUser)
	koGroup.POST("/activity", api.authKOMiddleware, api.koAddActivities)
	koGroup.POST("/syncs/activity", api.authKOMiddleware, api.koCheckActivitySync)
	koGroup.POST("/users/create", api.koCreateUser)
	koGroup.PUT("/syncs/progress", api.authKOMiddleware, api.koSetProgress)

	// Demo Mode Enabled Configuration
	if api.Config.DemoMode {
		koGroup.POST("/documents", api.authKOMiddleware, api.koDemoModeJSONError)
		koGroup.POST("/syncs/documents", api.authKOMiddleware, api.koDemoModeJSONError)
		koGroup.PUT("/documents/:document/file", api.authKOMiddleware, api.koDemoModeJSONError)
	} else {
		koGroup.POST("/documents", api.authKOMiddleware, api.koAddDocuments)
		koGroup.POST("/syncs/documents", api.authKOMiddleware, api.koCheckDocumentsSync)
		koGroup.PUT("/documents/:document/file", api.authKOMiddleware, api.koUploadExistingDocument)
	}
}

func (api *API) registerOPDSRoutes(apiGroup *gin.RouterGroup) {
	opdsGroup := apiGroup.Group("/opds")

	// OPDS Routes
	opdsGroup.GET("", api.authOPDSMiddleware, api.opdsEntry)
	opdsGroup.GET("/", api.authOPDSMiddleware, api.opdsEntry)
	opdsGroup.GET("/search.xml", api.authOPDSMiddleware, api.opdsSearchDescription)
	opdsGroup.GET("/documents", api.authOPDSMiddleware, api.opdsDocuments)
	opdsGroup.GET("/documents/:document/cover", api.authOPDSMiddleware, api.getDocumentCover)
	opdsGroup.GET("/documents/:document/file", api.authOPDSMiddleware, api.downloadDocument)
}

func (api *API) generateTemplates() *multitemplate.Renderer {
	// Define Templates & Helper Functions
	templates := make(map[string]*template.Template)
	render := multitemplate.NewRenderer()
	helperFuncs := template.FuncMap{
		"dict":            dict,
		"fields":          fields,
		"getSVGGraphData": getSVGGraphData,
		"getUTCOffsets":   getUTCOffsets,
		"hasPrefix":       strings.HasPrefix,
		"niceNumbers":     niceNumbers,
		"niceSeconds":     niceSeconds,
	}

	// Load Base
	b, _ := api.Assets.ReadFile("templates/base.html")
	baseTemplate := template.Must(template.New("base").Funcs(helperFuncs).Parse(string(b)))

	// Load SVGs
	svgs, _ := api.Assets.ReadDir("templates/svgs")
	for _, item := range svgs {
		basename := item.Name()
		path := fmt.Sprintf("templates/svgs/%s", basename)
		name := strings.TrimSuffix(basename, filepath.Ext(basename))

		b, _ := api.Assets.ReadFile(path)
		baseTemplate = template.Must(baseTemplate.New("svg/" + name).Parse(string(b)))
		templates["svg/"+name] = baseTemplate
	}

	// Load Components
	components, _ := api.Assets.ReadDir("templates/components")
	for _, item := range components {
		basename := item.Name()
		path := fmt.Sprintf("templates/components/%s", basename)
		name := strings.TrimSuffix(basename, filepath.Ext(basename))

		// Clone Base Template
		b, _ := api.Assets.ReadFile(path)
		baseTemplate = template.Must(baseTemplate.New("component/" + name).Parse(string(b)))
		render.Add("component/"+name, baseTemplate)
		templates["component/"+name] = baseTemplate
	}

	// Load Pages
	pages, _ := api.Assets.ReadDir("templates/pages")
	for _, item := range pages {
		basename := item.Name()
		path := fmt.Sprintf("templates/pages/%s", basename)
		name := strings.TrimSuffix(basename, filepath.Ext(basename))

		// Clone Base Template
		b, _ := api.Assets.ReadFile(path)
		pageTemplate, _ := template.Must(baseTemplate.Clone()).New("page/" + name).Parse(string(b))
		render.Add("page/"+name, pageTemplate)
		templates["page/"+name] = pageTemplate
	}

	api.Templates = templates

	return &render
}

func apiLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Start Timer
		startTime := time.Now()

		// Process Request
		c.Next()

		// End Timer
		endTime := time.Now()
		latency := endTime.Sub(startTime).Round(time.Microsecond)

		// Get Username
		var auth authData
		if data, _ := c.Get("Authorization"); data != nil {
			auth = data.(authData)
		}

		username := auth.UserName
		if username != "" {
			username = " (" + username + ")"
		}

		// Log Result
		log.Infof("[HTTPRouter] %-15s (%10s) %d %7s %s%s",
			c.ClientIP(),
			latency,
			c.Writer.Status(),
			c.Request.Method,
			c.Request.URL.Path,
			username,
		)
	}
}

func generateToken(n int) ([]byte, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	if err != nil {
		return nil, err
	}
	return b, nil
}
