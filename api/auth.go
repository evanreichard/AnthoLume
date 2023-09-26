package api

import (
	"crypto/md5"
	"fmt"
	"net/http"
	"strings"

	argon2 "github.com/alexedwards/argon2id"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"reichard.io/bbank/database"
)

type authHeader struct {
	AuthUser string `header:"x-auth-user"`
	AuthKey  string `header:"x-auth-key"`
}

func (api *API) authorizeCredentials(username string, password string) (authorized bool) {
	user, err := api.DB.Queries.GetUser(api.DB.Ctx, username)
	if err != nil {
		return false
	}

	if match, err := argon2.ComparePasswordAndHash(password, user.Pass); err != nil || match != true {
		return false
	}

	return true
}

func (api *API) authAPIMiddleware(c *gin.Context) {
	session := sessions.Default(c)

	// Utilize Session Token
	if authorizedUser := session.Get("authorizedUser"); authorizedUser != nil {
		c.Set("AuthorizedUser", authorizedUser)
		c.Header("Cache-Control", "private")
		c.Next()
		return
	}

	var rHeader authHeader
	if err := c.ShouldBindHeader(&rHeader); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Incorrect Headers"})
		return
	}
	if rHeader.AuthUser == "" || rHeader.AuthKey == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Invalid Authorization Headers"})
		return
	}

	if authorized := api.authorizeCredentials(rHeader.AuthUser, rHeader.AuthKey); authorized != true {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Set Session Cookie
	session.Set("authorizedUser", rHeader.AuthUser)
	session.Save()

	c.Set("AuthorizedUser", rHeader.AuthUser)
	c.Next()
}

func (api *API) authWebAppMiddleware(c *gin.Context) {
	session := sessions.Default(c)

	// Utilize Session Token
	if authorizedUser := session.Get("authorizedUser"); authorizedUser != nil {
		c.Set("AuthorizedUser", authorizedUser)
		c.Header("Cache-Control", "private")
		c.Next()
		return
	}

	c.Redirect(http.StatusFound, "/login")
	c.Abort()
}

func (api *API) authFormLogin(c *gin.Context) {
	username := strings.TrimSpace(c.PostForm("username"))
	rawPassword := strings.TrimSpace(c.PostForm("password"))

	if username == "" || rawPassword == "" {
		c.HTML(http.StatusUnauthorized, "login", gin.H{
			"RegistrationEnabled": api.Config.RegistrationEnabled,
			"Error":               "Invalid Credentials",
		})
		return
	}
	password := fmt.Sprintf("%x", md5.Sum([]byte(rawPassword)))

	if authorized := api.authorizeCredentials(username, password); authorized != true {
		c.HTML(http.StatusUnauthorized, "login", gin.H{
			"RegistrationEnabled": api.Config.RegistrationEnabled,
			"Error":               "Invalid Credentials",
		})
		return
	}

	session := sessions.Default(c)

	// Set Session Cookie
	session.Set("authorizedUser", username)
	session.Save()

	c.Redirect(http.StatusFound, "/")
}

func (api *API) authLogout(c *gin.Context) {
	session := sessions.Default(c)
	session.Clear()
	session.Save()
	c.Redirect(http.StatusFound, "/login")
}

func (api *API) authFormRegister(c *gin.Context) {
	if !api.Config.RegistrationEnabled {
		c.AbortWithStatus(http.StatusConflict)
	}

	username := strings.TrimSpace(c.PostForm("username"))
	rawPassword := strings.TrimSpace(c.PostForm("password"))

	if username == "" || rawPassword == "" {
		c.HTML(http.StatusBadRequest, "login", gin.H{
			"Register": true,
			"Error":    "Registration Disabled or User Already Exists",
		})
		return
	}
	password := fmt.Sprintf("%x", md5.Sum([]byte(rawPassword)))

	hashedPassword, err := argon2.CreateHash(password, argon2.DefaultParams)
	if err != nil {
		c.HTML(http.StatusBadRequest, "login", gin.H{
			"Register": true,
			"Error":    "Registration Disabled or User Already Exists",
		})
		return
	}

	rows, err := api.DB.Queries.CreateUser(api.DB.Ctx, database.CreateUserParams{
		ID:   username,
		Pass: hashedPassword,
	})

	// SQL Error
	if err != nil {
		c.HTML(http.StatusBadRequest, "login", gin.H{
			"Register": true,
			"Error":    "Registration Disabled or User Already Exists",
		})
		return
	}

	// User Already Exists
	if rows == 0 {
		c.HTML(http.StatusBadRequest, "login", gin.H{
			"Register": true,
			"Error":    "Registration Disabled or User Already Exists",
		})
		return
	}

	session := sessions.Default(c)

	// Set Session Cookie
	session.Set("authorizedUser", username)
	session.Save()

	c.Redirect(http.StatusFound, "/")
}
