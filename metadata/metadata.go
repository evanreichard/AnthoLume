package metadata

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"

	log "github.com/sirupsen/logrus"
)

type MetadataInfo struct {
	Title       *string
	Author      *string
	Description *string
	GBID        *string
	ISBN        []*string
}

type gBooksIdentifiers struct {
	Type       string `json:"type"`
	Identifier string `json:"identifier"`
}

type gBooksInfo struct {
	Title       string              `json:"title"`
	Authors     []string            `json:"authors"`
	Description string              `json:"description"`
	Identifiers []gBooksIdentifiers `json:"industryIdentifiers"`
}

type gBooksQueryItem struct {
	ID   string     `json:"id"`
	Info gBooksInfo `json:"volumeInfo"`
}

type gBooksQueryResponse struct {
	TotalItems int               `json:"totalItems"`
	Items      []gBooksQueryItem `json:"items"`
}

const GBOOKS_QUERY_URL string = "https://www.googleapis.com/books/v1/volumes?q=%s&filter=ebooks&download=epub"
const GBOOKS_GBID_INFO_URL string = "https://www.googleapis.com/books/v1/volumes/%s"
const GBOOKS_GBID_COVER_URL string = "https://books.google.com/books/content/images/frontcover/%s?fife=w480-h690"

func GetMetadata(data *MetadataInfo) error {
	var queryResult *gBooksQueryItem
	if data.GBID != nil {
		// Use GBID
		resp, err := performGBIDRequest(*data.GBID)
		if err != nil {
			return err
		}
		queryResult = resp
	} else if len(data.ISBN) > 0 {
		searchQuery := "isbn:" + *data.ISBN[0]
		resp, err := performSearchRequest(searchQuery)
		if err != nil {
			return err
		}
		queryResult = &resp.Items[0]
	} else if data.Title != nil && data.Author != nil {
		searchQuery := url.QueryEscape(fmt.Sprintf("%s %s", *data.Title, *data.Author))
		resp, err := performSearchRequest(searchQuery)
		if err != nil {
			return err
		}
		queryResult = &resp.Items[0]
	} else {
		return errors.New("Invalid Data")
	}

	// Merge Data
	data.GBID = &queryResult.ID
	data.Description = &queryResult.Info.Description
	data.Title = &queryResult.Info.Title
	if len(queryResult.Info.Authors) > 0 {
		data.Author = &queryResult.Info.Authors[0]
	}
	for _, item := range queryResult.Info.Identifiers {
		if item.Type == "ISBN_10" || item.Type == "ISBN_13" {
			data.ISBN = append(data.ISBN, &item.Identifier)
		}

	}

	return nil
}

func SaveCover(id string, safePath string) error {
	// Validate File Doesn't Exists
	_, err := os.Stat(safePath)
	if err == nil {
		log.Warn("[SaveCover] File Alreads Exists")
		return nil
	}

	// Create File
	out, err := os.Create(safePath)
	if err != nil {
		log.Error("[SaveCover] File Create Error")
		return errors.New("File Failure")
	}
	defer out.Close()

	// Download File
	log.Info("[SaveCover] Downloading Cover")
	coverURL := fmt.Sprintf(GBOOKS_GBID_COVER_URL, id)
	resp, err := http.Get(coverURL)
	if err != nil {
		log.Error("[SaveCover] Cover URL API Failure")
		return errors.New("API Failure")
	}
	defer resp.Body.Close()

	// Copy File to Disk
	log.Info("[SaveCover] Saving Cover")
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		log.Error("[SaveCover] File Copy Error")
		return errors.New("File Failure")
	}

	// Return FilePath
	return nil
}

func performSearchRequest(searchQuery string) (*gBooksQueryResponse, error) {
	apiQuery := fmt.Sprintf(GBOOKS_QUERY_URL, searchQuery)

	log.Info("[performSearchRequest] Acquiring CoverID")
	resp, err := http.Get(apiQuery)
	if err != nil {
		log.Error("[performSearchRequest] Cover URL API Failure")
		return nil, errors.New("API Failure")
	}

	parsedResp := gBooksQueryResponse{}
	err = json.NewDecoder(resp.Body).Decode(&parsedResp)
	if err != nil {
		log.Error("[performSearchRequest] Google Books Query API Decode Failure")
		return nil, errors.New("API Failure")
	}

	if len(parsedResp.Items) == 0 {
		log.Warn("[performSearchRequest] No Results")
		return nil, errors.New("No Results")
	}

	return &parsedResp, nil
}

func performGBIDRequest(id string) (*gBooksQueryItem, error) {
	apiQuery := fmt.Sprintf(GBOOKS_GBID_INFO_URL, id)

	log.Info("[performGBIDRequest] Acquiring CoverID")
	resp, err := http.Get(apiQuery)
	if err != nil {
		log.Error("[performGBIDRequest] Cover URL API Failure")
		return nil, errors.New("API Failure")
	}

	parsedResp := gBooksQueryItem{}
	err = json.NewDecoder(resp.Body).Decode(&parsedResp)
	if err != nil {
		log.Error("[performGBIDRequest] Google Books ID API Decode Failure")
		return nil, errors.New("API Failure")
	}

	return &parsedResp, nil
}
