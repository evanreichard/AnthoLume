package api

import (
	"context"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-contrib/multitemplate"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/microcosm-cc/bluemonday"
	"github.com/pkg/errors"
	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/api/renderer"
	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
	"reichard.io/antholume/utils"
)

type API struct {
	db            *database.DBManager
	cfg           *config.Config
	assets        fs.FS
	httpServer    *http.Server
	templates     map[string]*template.Template
	userAuthCache map[string]string
}

var htmlPolicy = bluemonday.StrictPolicy()

func NewApi(db *database.DBManager, c *config.Config, assets fs.FS) *API {
	api := &API{
		db:            db,
		cfg:           c,
		assets:        assets,
		templates:     make(map[string]*template.Template),
		userAuthCache: make(map[string]string),
	}

	// Create router
	router := gin.New()

	// Override renderer
	ginRenderer := router.HTMLRender
	router.HTMLRender = &renderer.HTMLTemplRenderer{FallbackHtmlRenderer: ginRenderer}

	// Add server
	api.httpServer = &http.Server{
		Handler: router,
		Addr:    (":" + c.ListenPort),
	}

	// Add global logging middleware
	router.Use(loggingMiddleware)

	// Add global template loader middleware (develop)
	if c.Version == "develop" {
		log.Info("utilizing debug template loader")
		router.Use(api.templateMiddleware(router))
	}

	// Assets & web app templates
	assetsDir, _ := fs.Sub(assets, "assets")
	router.StaticFS("/assets", http.FS(assetsDir))

	// Generate auth token
	var newToken []byte
	var err error
	if c.CookieAuthKey != "" {
		log.Info("utilizing environment cookie auth key")
		newToken = []byte(c.CookieAuthKey)
	} else {
		log.Info("generating cookie auth key")
		newToken, err = utils.GenerateToken(64)
		if err != nil {
			log.Panic("unable to generate cookie auth key")
		}
	}

	// Set enc token
	store := cookie.NewStore(newToken)
	if c.CookieEncKey != "" {
		if len(c.CookieEncKey) == 16 || len(c.CookieEncKey) == 32 {
			log.Info("utilizing environment cookie encryption key")
			store = cookie.NewStore(newToken, []byte(c.CookieEncKey))
		} else {
			log.Panic("invalid cookie encryption key (must be 16 or 32 bytes)")
		}
	}

	// Configure cookie session store
	store.Options(sessions.Options{
		MaxAge:   60 * 60 * 24 * 7,
		Secure:   c.CookieSecure,
		HttpOnly: c.CookieHTTPOnly,
		SameSite: http.SameSiteStrictMode,
	})
	router.Use(sessions.Sessions("token", store))

	// Register web app route
	api.registerWebAppRoutes(router)

	// Register API routes
	apiGroup := router.Group("/api")
	api.registerKOAPIRoutes(apiGroup)
	api.registerOPDSRoutes(apiGroup)

	return api
}

func (api *API) Start() error {
	return api.httpServer.ListenAndServe()
}

func (api *API) Stop() error {
	// Stop server
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
	// Generate templates
	router.HTMLRender = *api.generateTemplates()

	// Static assets (required @ root)
	router.GET("/manifest.json", api.appWebManifest)
	router.GET("/favicon.ico", api.appFaviconIcon)
	router.GET("/sw.js", api.appServiceWorker)

	// Local / offline static pages (no template, no auth)
	router.GET("/local", api.appLocalDocuments)

	// Reader (reader page, document progress, devices)
	router.GET("/reader", api.appDocumentReader)
	router.GET("/reader/devices", api.authWebAppMiddleware, api.appGetDevices)
	router.GET("/reader/progress/:document", api.authWebAppMiddleware, api.appGetDocumentProgress)

	// Web app
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
	router.GET("/admin/import", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appGetAdminImport)
	router.POST("/admin/import", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appPerformAdminImport)
	router.GET("/admin/users", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appGetAdminUsers)
	router.POST("/admin/users", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appUpdateAdminUsers)
	router.GET("/admin", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appGetAdmin)
	router.POST("/admin", api.authWebAppMiddleware, api.authAdminWebAppMiddleware, api.appPerformAdminAction)
	router.POST("/login", api.appAuthLogin)
	router.POST("/register", api.appAuthRegister)

	// Demo mode enabled configuration
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

	// Search enabled configuration
	if api.cfg.SearchEnabled {
		router.GET("/search", api.authWebAppMiddleware, api.appGetSearch)
		router.POST("/search", api.authWebAppMiddleware, api.appSaveNewDocument)
	}
}

func (api *API) registerKOAPIRoutes(apiGroup *gin.RouterGroup) {
	koGroup := apiGroup.Group("/ko")

	// KO sync routes (webapp uses - progress & activity)
	koGroup.GET("/documents/:document/file", api.authKOMiddleware, api.createDownloadDocumentHandler(apiErrorPage))
	koGroup.GET("/syncs/progress/:document", api.authKOMiddleware, api.koGetProgress)
	koGroup.GET("/users/auth", api.authKOMiddleware, api.koAuthorizeUser)
	koGroup.POST("/activity", api.authKOMiddleware, api.koAddActivities)
	koGroup.POST("/syncs/activity", api.authKOMiddleware, api.koCheckActivitySync)
	koGroup.POST("/users/create", api.koAuthRegister)
	koGroup.PUT("/syncs/progress", api.authKOMiddleware, api.koSetProgress)

	// Demo mode enabled configuration
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

	// OPDS routes
	opdsGroup.GET("", api.authOPDSMiddleware, api.opdsEntry)
	opdsGroup.GET("/", api.authOPDSMiddleware, api.opdsEntry)
	opdsGroup.GET("/search.xml", api.authOPDSMiddleware, api.opdsSearchDescription)
	opdsGroup.GET("/documents", api.authOPDSMiddleware, api.opdsDocuments)
	opdsGroup.GET("/documents/:document/cover", api.authOPDSMiddleware, api.createGetCoverHandler(apiErrorPage))
	opdsGroup.GET("/documents/:document/file", api.authOPDSMiddleware, api.createDownloadDocumentHandler(apiErrorPage))
}

func (api *API) generateTemplates() *multitemplate.Renderer {
	// Define templates & helper functions
	render := multitemplate.NewRenderer()
	templates := make(map[string]*template.Template)
	helperFuncs := template.FuncMap{
		"dict":            dict,
		"slice":           slice,
		"fields":          fields,
		"getSVGGraphData": getSVGGraphData,
		"getTimeZones":    getTimeZones,
		"hasPrefix":       strings.HasPrefix,
		"niceNumbers":     niceNumbers,
		"niceSeconds":     niceSeconds,
	}

	// Load Base
	b, err := fs.ReadFile(api.assets, "templates/base.tmpl")
	if err != nil {
		log.Errorf("error reading base template: %v", err)
		return &render
	}

	// Parse Base
	baseTemplate, err := template.New("base").Funcs(helperFuncs).Parse(string(b))
	if err != nil {
		log.Errorf("error parsing base template: %v", err)
		return &render
	}

	// Load SVGs
	err = api.loadTemplates("svg", baseTemplate, templates, false)
	if err != nil {
		log.Errorf("error loading svg templates: %v", err)
		return &render
	}

	// Load Components
	err = api.loadTemplates("component", baseTemplate, templates, false)
	if err != nil {
		log.Errorf("error loading component templates: %v", err)
		return &render
	}

	// Load Pages
	err = api.loadTemplates("page", baseTemplate, templates, true)
	if err != nil {
		log.Errorf("error loading page templates: %v", err)
		return &render
	}

	// Populate Renderer
	api.templates = templates
	for templateName, templateValue := range templates {
		render.Add(templateName, templateValue)
	}

	return &render
}

func (api *API) loadTemplates(
	basePath string,
	baseTemplate *template.Template,
	allTemplates map[string]*template.Template,
	cloneBase bool,
) error {
	// Load Templates (Pluralize)
	templateDirectory := fmt.Sprintf("templates/%ss", basePath)
	allFiles, err := fs.ReadDir(api.assets, templateDirectory)
	if err != nil {
		return errors.Wrap(err, fmt.Sprintf("unable to read template dir: %s", templateDirectory))
	}

	// Generate Templates
	for _, item := range allFiles {
		templateFile := item.Name()
		templatePath := path.Join(templateDirectory, templateFile)
		templateName := fmt.Sprintf("%s/%s", basePath, strings.TrimSuffix(templateFile, filepath.Ext(templateFile)))

		// Read Template
		b, err := fs.ReadFile(api.assets, templatePath)
		if err != nil {
			return errors.Wrap(err, fmt.Sprintf("unable to read template: %s", templateName))
		}

		// Clone? (Pages - Don't Stomp)
		if cloneBase {
			baseTemplate = template.Must(baseTemplate.Clone())
		}

		// Parse Template
		baseTemplate, err = baseTemplate.New(templateName).Parse(string(b))
		if err != nil {
			return errors.Wrap(err, fmt.Sprintf("unable to parse template: %s", templateName))
		}

		allTemplates[templateName] = baseTemplate
	}

	return nil
}

func loggingMiddleware(c *gin.Context) {
	// Start timer
	startTime := time.Now()

	// Process request
	c.Next()

	// End timer
	endTime := time.Now()
	latency := endTime.Sub(startTime).Round(time.Microsecond)

	// Log data
	logData := log.Fields{
		"type":    "access",
		"ip":      c.ClientIP(),
		"latency": latency.String(),
		"status":  c.Writer.Status(),
		"method":  c.Request.Method,
		"path":    c.Request.URL.Path,
	}

	// Get username
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	// Log user
	if auth.UserName != "" {
		logData["user"] = auth.UserName
	}

	// Log result
	log.WithFields(logData).Info(fmt.Sprintf("%s %s", c.Request.Method, c.Request.URL.Path))
}

func (api *API) templateMiddleware(router *gin.Engine) gin.HandlerFunc {
	return func(c *gin.Context) {
		router.HTMLRender = *api.generateTemplates()
		c.Next()
	}
}
