package metadata

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"github.com/jarcoal/httpmock"
	"github.com/stretchr/testify/assert"
)

// const GBOOKS_QUERY_URL string = "https://www.googleapis.com/books/v1/volumes?q=%s"
// const GBOOKS_GBID_INFO_URL string = "https://www.googleapis.com/books/v1/volumes/%s"
// const GBOOKS_GBID_COVER_URL string = "https://books.google.com/books/content/images/frontcover/%s?fife=w480-h690"

//go:embed _test_files/gbooks_id_response.json
var idResp string

//go:embed _test_files/gbooks_query_response.json
var queryResp string

type details struct {
	URLs []string
}

// Hook API Helper
func hookAPI() *details {
	// Start HTTPMock
	httpmock.Activate()

	// Create details struct
	d := &details{
		URLs: []string{},
	}

	// Create Hook
	matchRE := regexp.MustCompile(`^https://www\.googleapis\.com/books/v1/volumes.*`)
	httpmock.RegisterRegexpResponder("GET", matchRE, func(req *http.Request) (*http.Response, error) {
		// Append URL
		d.URLs = append(d.URLs, req.URL.String())

		// Get Raw Response
		var rawResp string
		if req.URL.Query().Get("q") != "" {
			rawResp = queryResp
		} else {
			rawResp = idResp
		}

		// Convert to JSON Response
		var responseData map[string]interface{}
		json.Unmarshal([]byte(rawResp), &responseData)

		// Return Response
		return httpmock.NewJsonResponse(200, responseData)
	})

	return d
}

func TestGBooksGBIDMetadata(t *testing.T) {
	hookDetails := hookAPI()
	defer httpmock.DeactivateAndReset()

	GBID := "ZxwpakTv_MIC"
	expectedURL := fmt.Sprintf(GBOOKS_GBID_INFO_URL, GBID)
	metadataResp, err := getGBooksMetadata(MetadataInfo{ID: &GBID})

	assert.Nil(t, err, "should not have error")
	assert.Contains(t, hookDetails.URLs, expectedURL, "should have intercepted URL")
	assert.Equal(t, 1, len(metadataResp), "should have single result")

	mResult := metadataResp[0]
	validateResult(t, &mResult)
}

func TestGBooksISBNQuery(t *testing.T) {
	hookDetails := hookAPI()
	defer httpmock.DeactivateAndReset()

	ISBN10 := "1877527815"
	expectedURL := fmt.Sprintf(GBOOKS_QUERY_URL, "isbn:"+ISBN10)
	metadataResp, err := getGBooksMetadata(MetadataInfo{
		ISBN10: &ISBN10,
	})

	assert.Nil(t, err, "should not have error")
	assert.Contains(t, hookDetails.URLs, expectedURL, "should have intercepted URL")
	assert.Equal(t, 1, len(metadataResp), "should have single result")

	mResult := metadataResp[0]
	validateResult(t, &mResult)
}

func TestGBooksTitleQuery(t *testing.T) {
	hookDetails := hookAPI()
	defer httpmock.DeactivateAndReset()

	title := "Alice in Wonderland 1877527815"
	expectedURL := fmt.Sprintf(GBOOKS_QUERY_URL, url.QueryEscape(strings.TrimSpace(title)))
	metadataResp, err := getGBooksMetadata(MetadataInfo{
		Title: &title,
	})

	assert.Nil(t, err, "should not have error")
	assert.Contains(t, hookDetails.URLs, expectedURL, "should have intercepted URL")
	assert.NotEqual(t, 0, len(metadataResp), "should not have no results")

	mResult := metadataResp[0]
	validateResult(t, &mResult)
}

func validateResult(t *testing.T, m *MetadataInfo) {
	expectedTitle := "Alice in Wonderland"
	expectedAuthor := "Lewis Carroll"
	expectedDesc := "Alice in Wonderland (also known as Alice's Adventures in Wonderland), from 1865, is the peculiar and imaginative tale of a girl who falls down a rabbit-hole into a bizarre world of eccentric and unusual creatures. Lewis Carroll's prominent example of the genre of \"literary nonsense\" has endured in popularity with its clever way of playing with logic and a narrative structure that has influence generations of fiction writing."
	expectedISBN10 := "1877527815"
	expectedISBN13 := "9781877527814"

	assert.Equal(t, expectedTitle, *m.Title, "should have title")
	assert.Equal(t, expectedAuthor, *m.Author, "should have author")
	assert.Equal(t, expectedDesc, *m.Description, "should have description")
	assert.Equal(t, expectedISBN10, *m.ISBN10, "should have ISBN10")
	assert.Equal(t, expectedISBN13, *m.ISBN13, "should have ISBN10")
}
