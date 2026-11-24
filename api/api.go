package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/microcosm-cc/bluemonday"
	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
	"reichard.io/antholume/reading"
	"reichard.io/antholume/utils"
)

type API struct {
	db             *database.DBManager
	cfg            *config.Config
	assets         fs.FS
	httpServer     *http.Server
	reading        *reading.Store
	hardcover      hardcoverFlow
	attempts       credentialLimiter
	identitySlots  chan struct{}
	restoreGate    sync.RWMutex
	libraryWrite   sync.Mutex
	webUploadSlots chan struct{}
	backupExport   sync.Mutex
	restoreStage   sync.Mutex
	adminJobs      adminJobLifecycle
}

var htmlPolicy = bluemonday.StrictPolicy()

// NewAPI composes the production router without starting a listener.
func NewAPI(db *database.DBManager, c *config.Config, assets fs.FS) (*API, error) {
	if err := c.ValidateConfigPath(); err != nil {
		return nil, err
	}
	if err := c.NormalizePublicOrigin(); err != nil {
		return nil, err
	}
	shellPaths, err := loadShellPaths(assets)
	if err != nil {
		return nil, err
	}
	api := &API{
		db:             db,
		cfg:            c,
		assets:         assets,
		reading:        &reading.Store{DB: db.DB},
		identitySlots:  make(chan struct{}, 4),
		webUploadSlots: make(chan struct{}, 2),
	}

	if err := api.configureHardcover(); err != nil {
		return nil, err
	}

	// Create router
	router := gin.New()
	router.UseRawPath = true
	router.UnescapePathValues = false
	router.Use(decodePathParameters)

	// Add server
	api.httpServer = &http.Server{
		Handler:           boundRequestBody(router, requestBodyIdleTimeout),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	// Add global logging middleware
	router.Use(loggingMiddleware)
	router.Use(api.restoreBoundary)
	router.Use(gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, _ any) {
		log.Error("request handler panic")
		if strings.HasPrefix(c.Request.URL.Path, "/api/v1/") {
			abortProblem(c, 500, "storage_error")
			return
		}
		c.AbortWithStatus(500)
	}))
	router.Use(api.appAssetPolicy)
	if err := router.SetTrustedProxies(c.TrustedProxies); err != nil {
		return nil, fmt.Errorf("invalid TRUSTED_PROXIES: %w", err)
	}

	assetsDir, _ := fs.Sub(assets, "assets")
	router.StaticFS("/assets", http.FS(assetsDir))

	// Generate auth token
	var newToken []byte
	if c.CookieAuthKey != "" {
		log.Info("utilizing environment cookie auth key")
		newToken = []byte(c.CookieAuthKey)
	} else {
		log.Info("generating cookie auth key")
		newToken, err = utils.GenerateToken(64)
		if err != nil {
			return nil, fmt.Errorf("unable to generate cookie auth key")
		}
	}

	// Set enc token
	store := cookie.NewStore(newToken)
	if c.CookieEncKey != "" {
		if len(c.CookieEncKey) == 16 || len(c.CookieEncKey) == 32 {
			log.Info("utilizing environment cookie encryption key")
			store = cookie.NewStore(newToken, []byte(c.CookieEncKey))
		} else {
			return nil, fmt.Errorf("invalid cookie encryption key (must be 16 or 32 bytes)")
		}
	}

	// Configure cookie session store
	store.Options(sessions.Options{
		MaxAge:   60 * 60 * 24 * 7,
		Path:     "/",
		Secure:   strings.HasPrefix(c.PublicOrigin, "https://"),
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
	router.Use(sessions.Sessions("token", store))

	// Register web app route
	router.GET("/manifest.json", api.appWebManifest)
	router.GET("/favicon.ico", api.appFaviconIcon)
	router.GET("/sw.js", api.appServiceWorker)
	router.GET(hardcoverCallbackPath, api.hardcoverCallback)
	router.POST(hardcoverCallbackPath, api.finishHardcoverCallback)

	// Register API routes
	apiGroup := router.Group("/api")
	api.registerKOAPIRoutes(apiGroup)
	api.registerOPDSRoutes(apiGroup)
	if err := api.registerV1(router); err != nil {
		return nil, err
	}
	router.NoRoute(func(c *gin.Context) {
		if (c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead) && shellPaths[c.Request.URL.EscapedPath()] {
			api.serveAppShell(c)
			return
		}
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			abortProblem(c, 404, "not_found")
			return
		}
		c.Status(404)
	})

	// Startup Recovery - This process is the sole owner, so old running rows have no worker.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.Queries.InterruptRunningAdminJobs(ctx, new(jobTime(time.Now()))); err != nil {
		return nil, fmt.Errorf("reconcile interrupted admin jobs: %w", err)
	}
	api.adminJobs.ctx, api.adminJobs.cancel = context.WithCancel(context.Background())
	api.adminJobs.drained = make(chan struct{})
	return api, nil
}

func (api *API) Handler() http.Handler { return api.httpServer.Handler }

func (api *API) Serve(listener net.Listener) error {
	return api.httpServer.Serve(listener)
}

func (api *API) Stop() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return api.Shutdown(ctx)
}

func (api *API) Shutdown(ctx context.Context) error {
	api.adminJobs.stop()
	httpErr := api.httpServer.Shutdown(ctx)
	if httpErr != nil {
		_ = api.httpServer.Close()
	}
	return errors.Join(httpErr, api.adminJobs.wait(ctx))
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
