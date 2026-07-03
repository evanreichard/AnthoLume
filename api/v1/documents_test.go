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
	"reichard.io/antholume/pkg/ptr"
)

type DocumentsTestSuite struct {
	suite.Suite
	db  *database.DBManager
	cfg *config.Config
	srv *Server
}

func (suite *DocumentsTestSuite) setupConfig() *config.Config {
	return &config.Config{
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
}

func TestDocuments(t *testing.T) {
	suite.Run(t, new(DocumentsTestSuite))
}

func (suite *DocumentsTestSuite) SetupTest() {
	suite.cfg = suite.setupConfig()
	suite.db = database.NewMgr(suite.cfg)
	suite.srv = NewServer(suite.db, suite.cfg, nil)
}

func (suite *DocumentsTestSuite) createTestUser(username, password string) {
	suite.authTestSuiteHelper(username, password)
}

func (suite *DocumentsTestSuite) login(username, password string) *http.Cookie {
	return suite.authLoginHelper(username, password)
}

func (suite *DocumentsTestSuite) authTestSuiteHelper(username, password string) {
	// MD5 hash for KOSync compatibility (matches existing system)
	md5Hash := fmt.Sprintf("%x", md5.Sum([]byte(password)))

	// Then argon2 hash the MD5
	hashedPassword, err := argon2.CreateHash(md5Hash, argon2.DefaultParams)
	suite.Require().NoError(err)

	_, err = suite.db.Queries.CreateUser(suite.T().Context(), database.CreateUserParams{
		ID:       username,
		Pass:     &hashedPassword,
		AuthHash: ptr.Of("test-auth-hash"),
		Admin:    true,
	})
	suite.Require().NoError(err)
}

func (suite *DocumentsTestSuite) authLoginHelper(username, password string) *http.Cookie {
	reqBody := LoginRequest{Username: username, Password: password}
	body, err := json.Marshal(reqBody)
	suite.Require().NoError(err)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
	w := httptest.NewRecorder()
	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)

	cookies := w.Result().Cookies()
	suite.Require().Len(cookies, 1)

	return cookies[0]
}

func (suite *DocumentsTestSuite) TestAPIGetDocuments() {
	suite.createTestUser("testuser", "testpass")
	cookie := suite.login("testuser", "testpass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents?page=1&limit=9", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)

	var resp DocumentsResponse
	suite.Require().NoError(json.Unmarshal(w.Body.Bytes(), &resp))
	suite.Equal(int64(1), resp.Page)
	suite.Equal(int64(9), resp.Limit)
}

func (suite *DocumentsTestSuite) TestAPIGetDocumentsUnauthenticated() {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents", nil)
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusUnauthorized, w.Code)
}

func (suite *DocumentsTestSuite) TestAPIGetDocument() {
	suite.createTestUser("testuser", "testpass")

	docID := "test-doc-1"
	_, err := suite.db.Queries.UpsertDocument(suite.T().Context(), database.UpsertDocumentParams{
		ID:       docID,
		Title:    ptr.Of("Test Document"),
		Author:   ptr.Of("Test Author"),
	})
	suite.Require().NoError(err)

	cookie := suite.login("testuser", "testpass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/"+docID, nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusOK, w.Code)

	var resp DocumentResponse
	suite.Require().NoError(json.Unmarshal(w.Body.Bytes(), &resp))
	suite.Equal(docID, resp.Document.Id)
	suite.Equal("Test Document", resp.Document.Title)
}

func (suite *DocumentsTestSuite) TestAPIGetDocumentNotFound() {
	suite.createTestUser("testuser", "testpass")
	cookie := suite.login("testuser", "testpass")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/non-existent", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusNotFound, w.Code)
}

func (suite *DocumentsTestSuite) TestAPIGetDocumentCoverUnauthenticated() {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/test-id/cover", nil)
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusUnauthorized, w.Code)
}

func (suite *DocumentsTestSuite) TestAPIGetDocumentFileUnauthenticated() {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/documents/test-id/file", nil)
	w := httptest.NewRecorder()

	suite.srv.ServeHTTP(w, req)

	suite.Equal(http.StatusUnauthorized, w.Code)
}