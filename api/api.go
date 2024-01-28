package api

import (
	"context"
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
	"reichard.io/antholume/utils"
)

type API struct {
	db            *database.DBManager
	cfg           *config.Config
	assets        *embed.FS
	httpServer    *http.Server
	templates     map[string]*template.Template
	userAuthCache map[string]string
}

var htmlPolicy = bluemonday.StrictPolicy()

func NewApi(db *database.DBManager, c *config.Config, assets *embed.FS) *API {
	api := &API{
		db:            db,
		cfg:           c,
		assets:        assets,
		userAuthCache: make(map[string]string),
	}

	// Create Router
	router := gin.New()

	// Add Server
	api.httpServer = &http.Server{
		Handler: router,
		Addr:    (":" + c.ListenPort),
	}

	// Add Logger
	router.Use(apiLogger())

	// Assets & Web App Templates
	assetsDir, _ := fs.Sub(assets, "assets")
	router.StaticFS("/assets", http.FS(assetsDir))

	// Generate Auth Token
	var newToken []byte
	var err error
	if c.CookieAuthKey != "" {
		log.Info("Utilizing environment cookie auth key")
		newToken = []byte(c.CookieAuthKey)
	} else {
		log.Info("Generating cookie auth key")
		newToken, err = utils.GenerateToken(64)
		if err != nil {
			log.Panic("Unable to generate cookie auth key")
		}
	}

	// Set Enc Token
	store := cookie.NewStore(newToken)
	if c.CookieEncKey != "" {
		if len(c.CookieEncKey) == 16 || len(c.CookieEncKey) == 32 {
			log.Info("Utilizing environment cookie encryption key")
			store = cookie.NewStore(newToken, []byte(c.CookieEncKey))
		} else {
			log.Panic("Invalid cookie encryption key (must be 16 or 32 bytes)")
		}
	}

	// Configure Cookie Session Store
	store.Options(sessions.Options{
		MaxAge:   60 * 60 * 24 * 7,
		Secure:   c.CookieSecure,
		HttpOnly: c.CookieHTTPOnly,
		SameSite: http.SameSiteStrictMode,
	})
	router.Use(sessions.Sessions("token", store))

	// Register Web App Route
	api.registerWebAppRoutes(router)

	// Register API Routes
	apiGroup := router.Group("/api")
	api.registerKOAPIRoutes(apiGroup)
	api.registerOPDSRoutes(apiGroup)

	return api
}

func (api *API) Start() error {
	return api.httpServer.ListenAndServe()
}

func (api *API) Stop() error {
	// Stop Server
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := api.httpServer.Shutdown(ctx)
	if err != nil {
		return err
	}

	// Close DB
	return api.db.DB.Close()
}

func (api *API) registerWebAppRoutes(router *gin.Engine) {
	// Generate Templates
	router.HTMLRender = *api.generateTemplates()

	// Static Assets (Required @ Root)
	router.GET("/manifest.json", api.appWebManifest)
	router.GET("/favicon.ico", api.appFaviconIcon)
	router.GET("/sw.js", api.appServiceWorker)

	// Local / Offline Static Pages (No Template, No Auth)
	router.GET("/local", api.appLocalDocuments)

	// Reader (Reader Page, Document Progress, Devices)
	router.GET("/reader", api.appDocumentReader)
	router.GET("/reader/devices", api.authWebAppMiddleware, api.appGetDevices)
	router.GET("/reader/progress/:document", api.authWebAppMiddleware, api.appGetDocumentProgress)

	// Web App
	router.GET("/", api.authWebAppMiddleware, api.appGetHome)
	router.GET("/activity", api.authWebAppMiddleware, api.appGetActivity)
	router.GET("/progress", api.authWebAppMiddleware, api.appGetProgress)
	router.GET("/documents", api.authWebAppMiddleware, api.appGetDocuments)
	router.GET("/documents/:document", api.authWebAppMiddleware, api.appGetDocument)
	router.GET("/documents/:document/cover", api.authWebAppMiddleware, api.createGetCoverHandler(appErrorPage))
	router.GET("/documents/:document/file", api.authWebAppMiddleware, api.createDownloadDocumentHandler(appErrorPage))
	router.GET("/login", api.appGetLogin)
	router.GET("/logout", api.authWebAppMiddleware, api.appAuthLogout)
	router.GET("/register", api.appGetRegister)
	router.GET("/settings", api.authWebAppMiddleware, api.appGetSettings)
	router.GET("/admin/logs", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appGetAdminLogs)
	router.GET("/admin/users", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appGetAdminUsers)
	router.GET("/admin", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appGetAdmin)
	router.POST("/admin", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appPerformAdminAction)
	router.POST("/login", api.appAuthFormLogin)
	router.POST("/register", api.appAuthFormRegister)

	// Demo Mode Enabled Configuration
	if api.cfg.DemoMode {
		router.POST("/documents", api.authWebAppMiddleware, api.appDemoModeError)
		router.POST("/documents/:document/delete", api.authWebAppMiddleware, api.appDemoModeError)
		router.POST("/documents/:document/edit", api.authWebAppMiddleware, api.appDemoModeError)
		router.POST("/documents/:document/identify", api.authWebAppMiddleware, api.appDemoModeError)
		router.POST("/settings", api.authWebAppMiddleware, api.appDemoModeError)
	} else {
		router.POST("/documents", api.authWebAppMiddleware, api.appUploadNewDocument)
		router.POST("/documents/:document/delete", api.authWebAppMiddleware, api.appDeleteDocument)
		router.POST("/documents/:document/edit", api.authWebAppMiddleware, api.appEditDocument)
		router.POST("/documents/:document/identify", api.authWebAppMiddleware, api.appIdentifyDocument)
		router.POST("/settings", api.authWebAppMiddleware, api.appEditSettings)
	}

	// Search Enabled Configuration
	if api.cfg.SearchEnabled {
		router.GET("/search", api.authWebAppMiddleware, api.appGetSearch)
		router.POST("/search", api.authWebAppMiddleware, api.appSaveNewDocument)
	}
}

func (api *API) registerKOAPIRoutes(apiGroup *gin.RouterGroup) {
	koGroup := apiGroup.Group("/ko")

	// KO Sync Routes (WebApp Uses - Progress & Activity)
	koGroup.GET("/documents/:document/file", api.authKOMiddleware, api.createDownloadDocumentHandler(apiErrorPage))
	koGroup.GET("/syncs/progress/:document", api.authKOMiddleware, api.koGetProgress)
	koGroup.GET("/users/auth", api.authKOMiddleware, api.koAuthorizeUser)
	koGroup.POST("/activity", api.authKOMiddleware, api.koAddActivities)
	koGroup.POST("/syncs/activity", api.authKOMiddleware, api.koCheckActivitySync)
	koGroup.POST("/users/create", api.koCreateUser)
	koGroup.PUT("/syncs/progress", api.authKOMiddleware, api.koSetProgress)

	// Demo Mode Enabled Configuration
	if api.cfg.DemoMode {
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
	opdsGroup.GET("/documents/:document/cover", api.authOPDSMiddleware, api.createGetCoverHandler(apiErrorPage))
	opdsGroup.GET("/documents/:document/file", api.authOPDSMiddleware, api.createDownloadDocumentHandler(apiErrorPage))
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
	b, _ := api.assets.ReadFile("templates/base.tmpl")
	baseTemplate := template.Must(template.New("base").Funcs(helperFuncs).Parse(string(b)))

	// Load SVGs
	svgs, _ := api.assets.ReadDir("templates/svgs")
	for _, item := range svgs {
		basename := item.Name()
		path := fmt.Sprintf("templates/svgs/%s", basename)
		name := strings.TrimSuffix(basename, filepath.Ext(basename))

		b, _ := api.assets.ReadFile(path)
		baseTemplate = template.Must(baseTemplate.New("svg/" + name).Parse(string(b)))
		templates["svg/"+name] = baseTemplate
	}

	// Load Components
	components, _ := api.assets.ReadDir("templates/components")
	for _, item := range components {
		basename := item.Name()
		path := fmt.Sprintf("templates/components/%s", basename)
		name := strings.TrimSuffix(basename, filepath.Ext(basename))

		// Clone Base Template
		b, _ := api.assets.ReadFile(path)
		baseTemplate = template.Must(baseTemplate.New("component/" + name).Parse(string(b)))
		render.Add("component/"+name, baseTemplate)
		templates["component/"+name] = baseTemplate
	}

	// Load Pages
	pages, _ := api.assets.ReadDir("templates/pages")
	for _, item := range pages {
		basename := item.Name()
		path := fmt.Sprintf("templates/pages/%s", basename)
		name := strings.TrimSuffix(basename, filepath.Ext(basename))

		// Clone Base Template
		b, _ := api.assets.ReadFile(path)
		pageTemplate, _ := template.Must(baseTemplate.Clone()).New("page/" + name).Parse(string(b))
		render.Add("page/"+name, pageTemplate)
		templates["page/"+name] = pageTemplate
	}

	api.templates = templates

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

		// Log Data
		logData := log.Fields{
			"type":    "access",
			"ip":      c.ClientIP(),
			"latency": fmt.Sprintf("%s", latency),
			"status":  c.Writer.Status(),
			"method":  c.Request.Method,
			"path":    c.Request.URL.Path,
		}

		// Get Username
		var auth authData
		if data, _ := c.Get("Authorization"); data != nil {
			auth = data.(authData)
		}

		// Log User
		if auth.UserName != "" {
			logData["user"] = auth.UserName
		}

		// Log Result
		log.WithFields(logData).Info(fmt.Sprintf("%s %s", c.Request.Method, c.Request.URL.Path))
	}
}
