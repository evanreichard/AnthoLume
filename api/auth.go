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
	"reichard.io/antholume/database"
	"reichard.io/antholume/utils"
)

// Authorization Data
type authData struct {
	UserName string
	IsAdmin  bool
	AuthHash string
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
	user, err := api.db.Queries.GetUser(api.db.Ctx, username)
	if err != nil {
		return
	}

	if match, err := argon2.ComparePasswordAndHash(password, *user.Pass); err != nil || match != true {
		return
	}

	// Update Auth Cache
	api.userAuthCache[user.ID] = user.AuthHash

	return &authData{
		UserName: user.ID,
		IsAdmin:  user.Admin,
		AuthHash: user.AuthHash,
	}
}

func (api *API) authKOMiddleware(c *gin.Context) {
	session := sessions.Default(c)

	// Check Session First
	if auth, ok := api.getSession(session); ok == true {
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

	if err := api.setSession(session, *authData); err != nil {
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
	if auth, ok := api.getSession(session); ok == true {
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

	appErrorPage(c, http.StatusUnauthorized, "Admin Permissions Required")
	c.Abort()
	return
}

func (api *API) appAuthFormLogin(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("login", c)

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
	if err := api.setSession(session, *authData); err != nil {
		templateVars["Error"] = "Invalid Credentials"
		c.HTML(http.StatusUnauthorized, "page/login", templateVars)
		return
	}

	c.Header("Cache-Control", "private")
	c.Redirect(http.StatusFound, "/")
}

func (api *API) appAuthFormRegister(c *gin.Context) {
	if !api.cfg.RegistrationEnabled {
		appErrorPage(c, http.StatusUnauthorized, "Nice try. Registration is disabled.")
		return
	}

	templateVars, _ := api.getBaseTemplateVars("login", c)
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

	// Generate Auth Hash
	rawAuthHash, err := utils.GenerateToken(64)
	if err != nil {
		log.Error("Failed to generate user token: ", err)
		templateVars["Error"] = "Failed to Create User"
		c.HTML(http.StatusBadRequest, "page/login", templateVars)
		return
	}

	// Create User in DB
	rows, err := api.db.Queries.CreateUser(api.db.Ctx, database.CreateUserParams{
		ID:       username,
		Pass:     &hashedPassword,
		AuthHash: fmt.Sprintf("%x", rawAuthHash),
	})

	// SQL Error
	if err != nil {
		log.Error("CreateUser DB Error:", err)
		templateVars["Error"] = "Registration Disabled or User Already Exists"
		c.HTML(http.StatusBadRequest, "page/login", templateVars)
		return
	}

	// User Already Exists
	if rows == 0 {
		log.Warn("User Already Exists:", username)
		templateVars["Error"] = "Registration Disabled or User Already Exists"
		c.HTML(http.StatusBadRequest, "page/login", templateVars)
		return
	}

	// Get User
	user, err := api.db.Queries.GetUser(api.db.Ctx, username)
	if err != nil {
		log.Error("GetUser DB Error:", err)
		templateVars["Error"] = "Registration Disabled or User Already Exists"
		c.HTML(http.StatusBadRequest, "page/login", templateVars)
		return
	}

	// Set Session
	auth := authData{
		UserName: user.ID,
		IsAdmin:  user.Admin,
		AuthHash: user.AuthHash,
	}
	session := sessions.Default(c)
	if err := api.setSession(session, auth); err != nil {
		appErrorPage(c, http.StatusUnauthorized, "Unauthorized.")
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

func (api *API) getSession(session sessions.Session) (auth authData, ok bool) {
	// Get Session
	authorizedUser := session.Get("authorizedUser")
	isAdmin := session.Get("isAdmin")
	expiresAt := session.Get("expiresAt")
	authHash := session.Get("authHash")
	if authorizedUser == nil || isAdmin == nil || expiresAt == nil || authHash == nil {
		return
	}

	// Create Auth Object
	auth = authData{
		UserName: authorizedUser.(string),
		IsAdmin:  isAdmin.(bool),
		AuthHash: authHash.(string),
	}

	// Validate Auth Hash
	correctAuthHash, err := api.getUserAuthHash(auth.UserName)
	if err != nil || correctAuthHash != auth.AuthHash {
		return
	}

	// Refresh
	if expiresAt.(int64)-time.Now().Unix() < 60*60*24 {
		log.Info("Refreshing Session")
		api.setSession(session, auth)
	}

	// Authorized
	return auth, true
}

func (api *API) setSession(session sessions.Session, auth authData) error {
	// Set Session Cookie
	session.Set("authorizedUser", auth.UserName)
	session.Set("isAdmin", auth.IsAdmin)
	session.Set("expiresAt", time.Now().Unix()+(60*60*24*7))
	session.Set("authHash", auth.AuthHash)

	return session.Save()
}

func (api *API) getUserAuthHash(username string) (string, error) {
	// Return Cache
	if api.userAuthCache[username] != "" {
		return api.userAuthCache[username], nil
	}

	// Get DB
	user, err := api.db.Queries.GetUser(api.db.Ctx, username)
	if err != nil {
		log.Error("GetUser DB Error:", err)
		return "", err
	}

	// Update Cache
	api.userAuthCache[username] = user.AuthHash

	return api.userAuthCache[username], nil
}

func (api *API) rotateUserAuthHash(username string) error {
	// Generate Auth Hash
	rawAuthHash, err := utils.GenerateToken(64)
	if err != nil {
		log.Error("Failed to generate user token: ", err)
		return err
	}

	// Update User
	_, err = api.db.Queries.UpdateUser(api.db.Ctx, database.UpdateUserParams{
		UserID:   username,
		AuthHash: fmt.Sprintf("%x", rawAuthHash),
	})

	// Update Cache
	api.userAuthCache[username] = fmt.Sprintf("%x", rawAuthHash)

	return nil
}
