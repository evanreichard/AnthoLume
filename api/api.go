package api

import (
	"crypto/rand"
	"html/template"
	"net/http"

	"github.com/gin-contrib/multitemplate"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"reichard.io/bbank/config"
	"reichard.io/bbank/database"
	"reichard.io/bbank/graph"
)

type API struct {
	Router *gin.Engine
	Config *config.Config
	DB     *database.DBManager
}

func NewApi(db *database.DBManager, c *config.Config) *API {
	api := &API{
		Router: gin.Default(),
		Config: c,
		DB:     db,
	}

	// Assets & Web App Templates
	api.Router.Static("/assets", "./assets")

	// Generate Secure Token
	newToken, err := generateToken(64)
	if err != nil {
		panic("Unable to generate secure token")
	}

	// Configure Cookie Session Store
	store := cookie.NewStore(newToken)
	store.Options(sessions.Options{
		MaxAge:   60 * 60 * 24,
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
	api.registerWebAPIRoutes(apiGroup)

	return api
}

func (api *API) registerWebAppRoutes() {
	// Define Templates & Helper Functions
	render := multitemplate.NewRenderer()
	helperFuncs := template.FuncMap{
		"GetSVGGraphData": graph.GetSVGGraphData,
	}

	render.AddFromFilesFuncs("login", helperFuncs, "templates/login.html")
	render.AddFromFilesFuncs("home", helperFuncs, "templates/base.html", "templates/home.html")
	render.AddFromFilesFuncs("graphs", helperFuncs, "templates/base.html", "templates/graphs.html")
	render.AddFromFilesFuncs("activity", helperFuncs, "templates/base.html", "templates/activity.html")
	render.AddFromFilesFuncs("documents", helperFuncs, "templates/base.html", "templates/documents.html")

	api.Router.HTMLRender = render

	api.Router.GET("/login", api.createAppResourcesRoute("login"))
	api.Router.GET("/register", api.createAppResourcesRoute("login", gin.H{"Register": true}))
	api.Router.GET("/logout", api.authWebAppMiddleware, api.authLogout)
	api.Router.POST("/login", api.authFormLogin)
	api.Router.POST("/register", api.authFormRegister)

	api.Router.GET("/", api.authWebAppMiddleware, api.createAppResourcesRoute("home"))
	api.Router.GET("/documents", api.authWebAppMiddleware, api.createAppResourcesRoute("documents"))
	api.Router.GET("/activity", api.authWebAppMiddleware, api.createAppResourcesRoute("activity"))
	api.Router.GET("/documents/:document/file", api.authWebAppMiddleware, api.downloadDocumentFile)
	api.Router.GET("/documents/:document/cover", api.authWebAppMiddleware, api.getDocumentCover)

	// TODO
	api.Router.GET("/graphs", api.authWebAppMiddleware, baseResourceRoute("graphs"))
}

func (api *API) registerKOAPIRoutes(apiGroup *gin.RouterGroup) {
	koGroup := apiGroup.Group("/ko")

	koGroup.GET("/info", api.serverInfo)

	koGroup.POST("/users/create", api.createUser)
	koGroup.GET("/users/auth", api.authAPIMiddleware, api.authorizeUser)

	koGroup.PUT("/syncs/progress", api.authAPIMiddleware, api.setProgress)
	koGroup.GET("/syncs/progress/:document", api.authAPIMiddleware, api.getProgress)

	koGroup.POST("/documents", api.authAPIMiddleware, api.addDocuments)
	koGroup.POST("/syncs/documents", api.authAPIMiddleware, api.checkDocumentsSync)
	koGroup.PUT("/documents/:document/file", api.authAPIMiddleware, api.uploadDocumentFile)
	koGroup.GET("/documents/:document/file", api.authAPIMiddleware, api.downloadDocumentFile)

	koGroup.POST("/activity", api.authAPIMiddleware, api.addActivities)
	koGroup.POST("/syncs/activity", api.authAPIMiddleware, api.checkActivitySync)
}

func (api *API) registerWebAPIRoutes(apiGroup *gin.RouterGroup) {
	v1Group := apiGroup.Group("/v1")

	v1Group.GET("/info", api.serverInfo)

	v1Group.POST("/users", api.createUser)
	v1Group.GET("/users", api.authAPIMiddleware, api.getUsers)

	v1Group.POST("/documents", api.authAPIMiddleware, api.checkDocumentsSync)
	v1Group.GET("/documents", api.authAPIMiddleware, api.getDocuments)

	v1Group.GET("/documents/:document/file", api.authAPIMiddleware, api.downloadDocumentFile)
	v1Group.PUT("/documents/:document/file", api.authAPIMiddleware, api.uploadDocumentFile)

	v1Group.GET("/activity", api.authAPIMiddleware, api.getActivity)
	v1Group.GET("/devices", api.authAPIMiddleware, api.getDevices)
}

func generateToken(n int) ([]byte, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	if err != nil {
		return nil, err
	}
	return b, nil
}
