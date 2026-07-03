package v1

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/suite"

	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

type ServerTestSuite struct {
	suite.Suite
	db  *database.DBManager
	cfg *config.Config
	srv *Server
}

func TestServer(t *testing.T) {
	suite.Run(t, new(ServerTestSuite))
}

func (suite *ServerTestSuite) SetupTest() {
	suite.cfg = &config.Config{
		ListenPort:        "8080",
		DBType:            "memory",
		DBName:            "test",
		ConfigPath:        "/tmp",
		CookieAuthKey:     "test-auth-key-32-bytes-long-enough",
		CookieEncKey:      "0123456789abcdef",
		CookieSecure:      false,
		CookieHTTPOnly:    true,
		Version:           "test",
		DemoMode:          false,
		RegistrationEnabled: true,
	}

	suite.db = database.NewMgr(suite.cfg)
	suite.srv = NewServer(suite.db, suite.cfg, nil)
}

func (suite *ServerTestSuite) TestNewServer() {
	suite.NotNil(suite.srv)
	suite.NotNil(suite.srv.mux)
	suite.NotNil(suite.srv.db)
	suite.NotNil(suite.srv.cfg)
}

func (suite *ServerTestSuite) TestServerServeHTTP() {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusUnauthorized, w.Code)
}