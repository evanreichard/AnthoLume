package v1

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/suite"
)

type UtilsTestSuite struct {
	suite.Suite
}

func TestUtils(t *testing.T) {
	suite.Run(t, new(UtilsTestSuite))
}

func (suite *UtilsTestSuite) TestWriteJSON() {
	w := httptest.NewRecorder()
	data := map[string]string{"test": "value"}

	writeJSON(w, http.StatusOK, data)

	suite.Equal("application/json", w.Header().Get("Content-Type"))
	suite.Equal(http.StatusOK, w.Code)

	var resp map[string]string
	suite.Require().NoError(json.Unmarshal(w.Body.Bytes(), &resp))
	suite.Equal("value", resp["test"])
}

func (suite *UtilsTestSuite) TestWriteJSONError() {
	w := httptest.NewRecorder()

	writeJSONError(w, http.StatusBadRequest, "test error")

	suite.Equal(http.StatusBadRequest, w.Code)

	var resp ErrorResponse
	suite.Require().NoError(json.Unmarshal(w.Body.Bytes(), &resp))
	suite.Equal(http.StatusBadRequest, resp.Code)
	suite.Equal("test error", resp.Message)
}

func (suite *UtilsTestSuite) TestParseQueryParams() {
	query := make(map[string][]string)
	query["page"] = []string{"2"}
	query["limit"] = []string{"15"}
	query["search"] = []string{"test"}

	params := parseQueryParams(query, 9)

	suite.Equal(int64(2), params.Page)
	suite.Equal(int64(15), params.Limit)
	suite.NotNil(params.Search)
}

func (suite *UtilsTestSuite) TestParseQueryParamsDefaults() {
	query := make(map[string][]string)

	params := parseQueryParams(query, 9)

	suite.Equal(int64(1), params.Page)
	suite.Equal(int64(9), params.Limit)
	suite.Nil(params.Search)
}

func (suite *UtilsTestSuite) TestPtrOf() {
	value := "test"
	ptr := ptrOf(value)

	suite.NotNil(ptr)
	suite.Equal("test", *ptr)
}