package api

import (
	"crypto/rand"
	"html/template"
	"net/http"

	"github.com/gin-contrib/multitemplate"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/microcosm-cc/bluemonday"
	log "github.com/sirupsen/logrus"
	"reichard.io/bbank/config"
	"reichard.io/bbank/database"
)

type API struct {
	Router     *gin.Engine
	Config     *config.Config
	DB         *database.DBManager
	HTMLPolicy *bluemonday.Policy
}

func NewApi(db *database.DBManager, c *config.Config) *API {
	api := &API{
		HTMLPolicy: bluemonday.StrictPolicy(),
		Router:     gin.Default(),
		Config:     c,
		DB:         db,
	}

	// Assets & Web App Templates
	api.Router.Static("/assets", "./assets")

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
		Secure:   true,
		HttpOnly: true,
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
	// Define Templates & Helper Functions
	render := multitemplate.NewRenderer()
	helperFuncs := template.FuncMap{
		"GetSVGGraphData": getSVGGraphData,
		"GetUTCOffsets":   getUTCOffsets,
		"NiceSeconds":     niceSeconds,
	}

	render.AddFromFilesFuncs("login", helperFuncs, "templates/login.html")
	render.AddFromFilesFuncs("reader", helperFuncs, "templates/reader-base.html", "templates/reader.html")
	render.AddFromFilesFuncs("home", helperFuncs, "templates/base.html", "templates/home.html")
	render.AddFromFilesFuncs("search", helperFuncs, "templates/base.html", "templates/search.html")
	render.AddFromFilesFuncs("settings", helperFuncs, "templates/base.html", "templates/settings.html")
	render.AddFromFilesFuncs("activity", helperFuncs, "templates/base.html", "templates/activity.html")
	render.AddFromFilesFuncs("documents", helperFuncs, "templates/base.html", "templates/documents.html")
	render.AddFromFilesFuncs("document", helperFuncs, "templates/base.html", "templates/document.html")

	api.Router.HTMLRender = render

	api.Router.GET("/manifest.json", api.webManifest)
	api.Router.GET("/login", api.createAppResourcesRoute("login"))
	api.Router.GET("/register", api.createAppResourcesRoute("login", gin.H{"Register": true}))
	api.Router.GET("/logout", api.authWebAppMiddleware, api.authLogout)
	api.Router.POST("/login", api.authFormLogin)
	api.Router.POST("/register", api.authFormRegister)

	api.Router.GET("/", api.authWebAppMiddleware, api.createAppResourcesRoute("home"))
	api.Router.GET("/settings", api.authWebAppMiddleware, api.createAppResourcesRoute("settings"))
	api.Router.POST("/settings", api.authWebAppMiddleware, api.editSettings)
	api.Router.GET("/activity", api.authWebAppMiddleware, api.createAppResourcesRoute("activity"))
	api.Router.GET("/documents", api.authWebAppMiddleware, api.createAppResourcesRoute("documents"))
	api.Router.GET("/documents/:document", api.authWebAppMiddleware, api.createAppResourcesRoute("document"))
	api.Router.GET("/documents/:document/reader", api.authWebAppMiddleware, api.documentReader)
	api.Router.GET("/documents/:document/file", api.authWebAppMiddleware, api.downloadDocumentFile)
	api.Router.GET("/documents/:document/cover", api.authWebAppMiddleware, api.getDocumentCover)
	api.Router.POST("/documents/:document/edit", api.authWebAppMiddleware, api.editDocument)
	api.Router.POST("/documents/:document/identify", api.authWebAppMiddleware, api.identifyDocument)
	api.Router.POST("/documents/:document/delete", api.authWebAppMiddleware, api.deleteDocument)

	// Behind Configuration Flag
	if api.Config.SearchEnabled {
		api.Router.GET("/search", api.authWebAppMiddleware, api.createAppResourcesRoute("search"))
		api.Router.POST("/search", api.authWebAppMiddleware, api.saveNewDocument)
	}
}

func (api *API) registerKOAPIRoutes(apiGroup *gin.RouterGroup) {
	koGroup := apiGroup.Group("/ko")

	koGroup.POST("/users/create", api.createUser)
	koGroup.GET("/users/auth", api.authKOMiddleware, api.authorizeUser)

	koGroup.PUT("/syncs/progress", api.authKOMiddleware, api.setProgress)
	koGroup.GET("/syncs/progress/:document", api.authKOMiddleware, api.getProgress)

	koGroup.POST("/documents", api.authKOMiddleware, api.addDocuments)
	koGroup.POST("/syncs/documents", api.authKOMiddleware, api.checkDocumentsSync)
	koGroup.PUT("/documents/:document/file", api.authKOMiddleware, api.uploadDocumentFile)
	koGroup.GET("/documents/:document/file", api.authKOMiddleware, api.downloadDocumentFile)

	koGroup.POST("/activity", api.authKOMiddleware, api.addActivities)
	koGroup.POST("/syncs/activity", api.authKOMiddleware, api.checkActivitySync)
}

func (api *API) registerOPDSRoutes(apiGroup *gin.RouterGroup) {
	opdsGroup := apiGroup.Group("/opds")

	opdsGroup.GET("/", api.authOPDSMiddleware, api.opdsDocuments)
	opdsGroup.GET("/search.xml", api.authOPDSMiddleware, api.opdsSearchDescription)
	opdsGroup.GET("/documents/:document/file", api.authOPDSMiddleware, api.downloadDocumentFile)
	opdsGroup.GET("/documents/:document/cover", api.authOPDSMiddleware, api.getDocumentCover)
}

func generateToken(n int) ([]byte, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	if err != nil {
		return nil, err
	}
	return b, nil
}
