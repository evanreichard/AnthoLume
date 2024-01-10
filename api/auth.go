package api

import (
	"crypto/md5"
	"fmt"
	"net/http"
	"strings"
	"time"

	argon2 "github.com/alexedwards/argon2id"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"reichard.io/bbank/database"
)

// Authorization Data
type authData struct {
	UserName string
	IsAdmin  bool
}

// KOSync API Auth Headers
type authKOHeader struct {
	AuthUser string `header:"x-auth-user"`
	AuthKey  string `header:"x-auth-key"`
}

// OPDS Auth Headers
type authOPDSHeader struct {
	Authorization string `header:"authorization"`
}

func (api *API) authorizeCredentials(username string, password string) (auth *authData) {
	user, err := api.DB.Queries.GetUser(api.DB.Ctx, username)
	if err != nil {
		return
	}

	if match, err := argon2.ComparePasswordAndHash(password, *user.Pass); err != nil || match != true {
		return
	}

	return &authData{
		UserName: user.ID,
		IsAdmin:  user.Admin,
	}
}

func (api *API) authKOMiddleware(c *gin.Context) {
	session := sessions.Default(c)

	// Check Session First
	if auth, ok := getSession(session); ok == true {
		c.Set("Authorization", auth)
		c.Header("Cache-Control", "private")
		c.Next()
		return
	}

	// Session Failed -> Check Headers (Allowed on API for KOSync Compatibility)

	var rHeader authKOHeader
	if err := c.ShouldBindHeader(&rHeader); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Incorrect Headers"})
		return
	}
	if rHeader.AuthUser == "" || rHeader.AuthKey == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid Authorization Headers"})
		return
	}

	authData := api.authorizeCredentials(rHeader.AuthUser, rHeader.AuthKey)
	if authData == nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	if err := setSession(session, *authData); err != nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	c.Set("Authorization", *authData)
	c.Header("Cache-Control", "private")
	c.Next()
}

func (api *API) authOPDSMiddleware(c *gin.Context) {
	c.Header("WWW-Authenticate", `Basic realm="restricted", charset="UTF-8"`)

	user, rawPassword, hasAuth := c.Request.BasicAuth()

	// Validate Auth Fields
	if hasAuth != true || user == "" || rawPassword == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid Authorization Headers"})
		return
	}

	// Validate Auth
	password := fmt.Sprintf("%x", md5.Sum([]byte(rawPassword)))
	authData := api.authorizeCredentials(user, password)
	if authData == nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	c.Set("Authorization", *authData)
	c.Header("Cache-Control", "private")
	c.Next()
}

func (api *API) authWebAppMiddleware(c *gin.Context) {
	session := sessions.Default(c)

	// Check Session
	if auth, ok := getSession(session); ok == true {
		c.Set("Authorization", auth)
		c.Header("Cache-Control", "private")
		c.Next()
		return
	}

	c.Redirect(http.StatusFound, "/login")
	c.Abort()
	return
}

func (api *API) authAdminWebAppMiddleware(c *gin.Context) {
	if data, _ := c.Get("Authorization"); data != nil {
		auth := data.(authData)
		if auth.IsAdmin == true {
			c.Next()
			return
		}
	}

	errorPage(c, http.StatusUnauthorized, "Admin Permissions Required")
	c.Abort()
	return
}

func (api *API) appAuthFormLogin(c *gin.Context) {
	templateVars := api.getBaseTemplateVars("login", c)

	username := strings.TrimSpace(c.PostForm("username"))
	rawPassword := strings.TrimSpace(c.PostForm("password"))

	if username == "" || rawPassword == "" {
		templateVars["Error"] = "Invalid Credentials"
		c.HTML(http.StatusUnauthorized, "page/login", templateVars)
		return
	}

	// MD5 - KOSync Compatiblity
	password := fmt.Sprintf("%x", md5.Sum([]byte(rawPassword)))
	authData := api.authorizeCredentials(username, password)
	if authData == nil {
		templateVars["Error"] = "Invalid Credentials"
		c.HTML(http.StatusUnauthorized, "page/login", templateVars)
		return
	}

	// Set Session
	session := sessions.Default(c)
	if err := setSession(session, *authData); err != nil {
		templateVars["Error"] = "Invalid Credentials"
		c.HTML(http.StatusUnauthorized, "page/login", templateVars)
		return
	}

	c.Header("Cache-Control", "private")
	c.Redirect(http.StatusFound, "/")
}

func (api *API) appAuthFormRegister(c *gin.Context) {
	if !api.Config.RegistrationEnabled {
		errorPage(c, http.StatusUnauthorized, "Nice try. Registration is disabled.")
		return
	}

	templateVars := api.getBaseTemplateVars("login", c)
	templateVars["Register"] = true

	username := strings.TrimSpace(c.PostForm("username"))
	rawPassword := strings.TrimSpace(c.PostForm("password"))

	if username == "" || rawPassword == "" {
		templateVars["Error"] = "Invalid User or Password"
		c.HTML(http.StatusBadRequest, "page/login", templateVars)
		return
	}
	password := fmt.Sprintf("%x", md5.Sum([]byte(rawPassword)))

	hashedPassword, err := argon2.CreateHash(password, argon2.DefaultParams)
	if err != nil {
		templateVars["Error"] = "Registration Disabled or User Already Exists"
		c.HTML(http.StatusBadRequest, "page/login", templateVars)
		return
	}

	rows, err := api.DB.Queries.CreateUser(api.DB.Ctx, database.CreateUserParams{
		ID:   username,
		Pass: &hashedPassword,
	})

	// SQL Error
	if err != nil {
		log.Error("[appAuthFormRegister] CreateUser DB Error:", err)
		templateVars["Error"] = "Registration Disabled or User Already Exists"
		c.HTML(http.StatusBadRequest, "page/login", templateVars)
		return
	}

	// User Already Exists
	if rows == 0 {
		log.Warn("[appAuthFormRegister] User Already Exists:", username)
		templateVars["Error"] = "Registration Disabled or User Already Exists"
		c.HTML(http.StatusBadRequest, "page/login", templateVars)
		return
	}

	// Get User
	user, err := api.DB.Queries.GetUser(api.DB.Ctx, username)
	if err != nil {
		log.Error("[appAuthFormRegister] GetUser DB Error:", err)
		templateVars["Error"] = "Registration Disabled or User Already Exists"
		c.HTML(http.StatusBadRequest, "page/login", templateVars)
		return
	}

	// Set Session
	auth := authData{
		UserName: user.ID,
		IsAdmin:  user.Admin,
	}
	session := sessions.Default(c)
	if err := setSession(session, auth); err != nil {
		errorPage(c, http.StatusUnauthorized, "Unauthorized.")
		return
	}

	c.Header("Cache-Control", "private")
	c.Redirect(http.StatusFound, "/")
}

func (api *API) appAuthLogout(c *gin.Context) {
	session := sessions.Default(c)
	session.Clear()
	session.Save()
	c.Redirect(http.StatusFound, "/login")
}

func getSession(session sessions.Session) (auth authData, ok bool) {
	// Check Session
	authorizedUser := session.Get("authorizedUser")
	isAdmin := session.Get("isAdmin")
	expiresAt := session.Get("expiresAt")
	if authorizedUser == nil || isAdmin == nil || expiresAt == nil {
		return
	}

	// Create Auth Object
	auth = authData{
		UserName: authorizedUser.(string),
		IsAdmin:  isAdmin.(bool),
	}

	// Refresh
	if expiresAt.(int64)-time.Now().Unix() < 60*60*24 {
		log.Info("[getSession] Refreshing Session")
		setSession(session, auth)
	}

	// Authorized
	return auth, true
}

func setSession(session sessions.Session, auth authData) error {
	// Set Session Cookie
	session.Set("authorizedUser", auth.UserName)
	session.Set("isAdmin", auth.IsAdmin)
	session.Set("expiresAt", time.Now().Unix()+(60*60*24*7))
	return session.Save()
}
