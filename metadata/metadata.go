package metadata

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	log "github.com/sirupsen/logrus"
)

type MetadataInfo struct {
	Title       *string
	Author      *string
	Description *string
	GBID        *string
	OLID        *string
	ISBN10      *string
	ISBN13      *string
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

const GBOOKS_QUERY_URL string = "https://www.googleapis.com/books/v1/volumes?q=%s"
const GBOOKS_GBID_INFO_URL string = "https://www.googleapis.com/books/v1/volumes/%s"
const GBOOKS_GBID_COVER_URL string = "https://books.google.com/books/content/images/frontcover/%s?fife=w480-h690"

func GetMetadata(metadataSearch MetadataInfo) ([]MetadataInfo, error) {
	var queryResults []gBooksQueryItem
	if metadataSearch.GBID != nil {
		// Use GBID
		resp, err := performGBIDRequest(*metadataSearch.GBID)
		if err != nil {
			return nil, err
		}

		queryResults = []gBooksQueryItem{*resp}
	} else if metadataSearch.ISBN13 != nil {
		searchQuery := "isbn:" + *metadataSearch.ISBN13
		resp, err := performSearchRequest(searchQuery)
		if err != nil {
			return nil, err
		}

		queryResults = resp.Items
	} else if metadataSearch.ISBN10 != nil {
		searchQuery := "isbn:" + *metadataSearch.ISBN10
		resp, err := performSearchRequest(searchQuery)
		if err != nil {
			return nil, err
		}

		queryResults = resp.Items
	} else if metadataSearch.Title != nil || metadataSearch.Author != nil {
		var searchQuery string
		if metadataSearch.Title != nil {
			searchQuery = searchQuery + *metadataSearch.Title
		}
		if metadataSearch.Author != nil {
			searchQuery = searchQuery + " " + *metadataSearch.Author
		}

		// Escape & Trim
		searchQuery = url.QueryEscape(strings.TrimSpace(searchQuery))
		resp, err := performSearchRequest(searchQuery)
		if err != nil {
			return nil, err
		}

		queryResults = resp.Items
	} else {
		return nil, errors.New("Invalid Data")
	}

	// Normalize Data
	allMetadata := []MetadataInfo{}
	for i := range queryResults {
		item := queryResults[i] // Range Value Pointer Issue
		itemResult := MetadataInfo{
			GBID:        &item.ID,
			Title:       &item.Info.Title,
			Description: &item.Info.Description,
		}

		if len(item.Info.Authors) > 0 {
			itemResult.Author = &item.Info.Authors[0]
		}

		for i := range item.Info.Identifiers {
			item := item.Info.Identifiers[i] // Range Value Pointer Issue

			if itemResult.ISBN10 != nil && itemResult.ISBN13 != nil {
				break
			} else if itemResult.ISBN10 == nil && item.Type == "ISBN_10" {
				itemResult.ISBN10 = &item.Identifier
			} else if itemResult.ISBN13 == nil && item.Type == "ISBN_13" {
				itemResult.ISBN13 = &item.Identifier
			}
		}

		allMetadata = append(allMetadata, itemResult)
	}

	return allMetadata, nil
}

func SaveCover(gbid string, coverDir string, documentID string, overwrite bool) (*string, error) {

	// Google Books -> JPG
	coverFile := "." + filepath.Clean(fmt.Sprintf("/%s.jpg", documentID))
	coverFilePath := filepath.Join(coverDir, coverFile)

	// Validate File Doesn't Exists
	_, err := os.Stat(coverFilePath)
	if err == nil && overwrite == false {
		log.Warn("[SaveCover] File Alreads Exists")
		return &coverFile, nil
	}

	// Create File
	out, err := os.Create(coverFilePath)
	if err != nil {
		log.Error("[SaveCover] File Create Error")
		return nil, errors.New("File Failure")
	}
	defer out.Close()

	// Download File
	log.Info("[SaveCover] Downloading Cover")
	coverURL := fmt.Sprintf(GBOOKS_GBID_COVER_URL, gbid)
	resp, err := http.Get(coverURL)
	if err != nil {
		log.Error("[SaveCover] Cover URL API Failure")
		return nil, errors.New("API Failure")
	}
	defer resp.Body.Close()

	// Copy File to Disk
	log.Info("[SaveCover] Saving Cover")
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		log.Error("[SaveCover] File Copy Error")
		return nil, errors.New("File Failure")
	}

	// Return FilePath
	return &coverFile, nil
}

func performSearchRequest(searchQuery string) (*gBooksQueryResponse, error) {
	apiQuery := fmt.Sprintf(GBOOKS_QUERY_URL, searchQuery)
	log.Info("[performSearchRequest] Acquiring Metadata: ", apiQuery)
	resp, err := http.Get(apiQuery)
	if err != nil {
		log.Error("[performSearchRequest] Google Books Query URL API Failure")
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
