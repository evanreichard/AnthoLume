package v1

import (
	"bytes"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/suite"

	argon2 "github.com/alexedwards/argon2id"
	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

type AuthTestSuite struct {
	suite.Suite
	db  *database.DBManager
	cfg *config.Config
	srv *Server
}

func (suite *AuthTestSuite) setupConfig() *config.Config {
	return &config.Config{
		ListenPort:          "8080",
		DBType:              "memory",
		DBName:              "test",
		ConfigPath:          "/tmp",
		CookieAuthKey:       "test-auth-key-32-bytes-long-enough",
		CookieEncKey:        "0123456789abcdef",
		CookieSecure:        false,
		CookieHTTPOnly:      true,
		Version:             "test",
		DemoMode:            false,
		RegistrationEnabled: true,
	}
}

func TestAuth(t *testing.T) {
	suite.Run(t, new(AuthTestSuite))
}

func (suite *AuthTestSuite) SetupTest() {
	suite.cfg = suite.setupConfig()
	suite.db = database.NewMgr(suite.cfg)
	suite.srv = NewServer(suite.db, suite.cfg, nil)
}

func (suite *AuthTestSuite) createTestUser(username, password string) {
	md5Hash := fmt.Sprintf("%x", md5.Sum([]byte(password)))

	hashedPassword, err := argon2.CreateHash(md5Hash, argon2.DefaultParams)
	suite.Require().NoError(err)

	authHash := "test-auth-hash"

	_, err = suite.db.Queries.CreateUser(suite.T().Context(), database.CreateUserParams{
		ID:       username,
		Pass:     &hashedPassword,
		AuthHash: &authHash,
		Admin:    true,
	})
	suite.Require().NoError(err)
}

func (suite *AuthTestSuite) assertSessionCookie(cookie *http.Cookie) {
	suite.Require().NotNil(cookie)
	suite.Equal("token", cookie.Name)
	suite.NotEmpty(cookie.Value)
	suite.True(cookie.HttpOnly)
}

func (suite *AuthTestSuite) login(username, password string) *http.Cookie {
	reqBody := LoginRequest{
		Username: username,
		Password: password,
	}
	body, err := json.Marshal(reqBody)
	suite.Require().NoError(err)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code, "login should return 200")

	var resp LoginResponse
	suite.Require().NoError(json.Unmarshal(w.Body.Bytes(), &resp))

	cookies := w.Result().Cookies()
	suite.Require().Len(cookies, 1, "should have session cookie")
	suite.assertSessionCookie(cookies[0])

	return cookies[0]
}

func (suite *AuthTestSuite) TestAPILogin() {
	suite.createTestUser("testuser", "testpass")

	reqBody := LoginRequest{
		Username: "testuser",
		Password: "testpass",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)

	var resp LoginResponse
	suite.Require().NoError(json.Unmarshal(w.Body.Bytes(), &resp))
	suite.Equal("testuser", resp.Username)

	cookies := w.Result().Cookies()
	suite.Require().Len(cookies, 1)
	suite.assertSessionCookie(cookies[0])
}

func (suite *AuthTestSuite) TestAPILoginInvalidCredentials() {
	reqBody := LoginRequest{
		Username: "testuser",
		Password: "wrongpass",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusUnauthorized, w.Code)
}

func (suite *AuthTestSuite) TestAPIRegister() {
	reqBody := LoginRequest{
		Username: "newuser",
		Password: "newpass",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(body))
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusCreated, w.Code)

	var resp LoginResponse
	suite.Require().NoError(json.Unmarshal(w.Body.Bytes(), &resp))
	suite.Equal("newuser", resp.Username)
	suite.True(resp.IsAdmin, "first registered user should mirror legacy admin bootstrap behavior")

	cookies := w.Result().Cookies()
	suite.Require().Len(cookies, 1, "register should set a session cookie")
	suite.assertSessionCookie(cookies[0])

	user, err := suite.db.Queries.GetUser(suite.T().Context(), "newuser")
	suite.Require().NoError(err)
	suite.True(user.Admin)
}

func (suite *AuthTestSuite) TestAPIRegisterDisabled() {
	suite.cfg.RegistrationEnabled = false
	suite.srv = NewServer(suite.db, suite.cfg, nil)

	reqBody := LoginRequest{
		Username: "newuser",
		Password: "newpass",
	}
	body, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(body))
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusForbidden, w.Code)
}

func (suite *AuthTestSuite) TestAPILogout() {
	suite.createTestUser("testuser", "testpass")
	cookie := suite.login("testuser", "testpass")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)

	cookies := w.Result().Cookies()
	suite.Require().Len(cookies, 1)
	suite.Equal("token", cookies[0].Name)
}

func (suite *AuthTestSuite) TestAPIGetMe() {
	suite.createTestUser("testuser", "testpass")
	cookie := suite.login("testuser", "testpass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)

	var resp UserData
	suite.Require().NoError(json.Unmarshal(w.Body.Bytes(), &resp))
	suite.Equal("testuser", resp.Username)
}

func (suite *AuthTestSuite) TestAPIGetMeUnauthenticated() {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusUnauthorized, w.Code)
}
