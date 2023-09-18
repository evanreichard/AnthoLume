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

	log "github.com/sirupsen/logrus"
)

type coverResult struct {
	CoverEditionKey string `json:"cover_edition_key"`
}

type queryResponse struct {
	ResultCount      int           `json:"numFound"`
	Start            int           `json:"start"`
	ResultCountExact bool          `json:"numFoundExact"`
	Results          []coverResult `json:"docs"`
}

var BASE_QUERY_URL string = "https://openlibrary.org/search.json?q=%s&fields=cover_edition_key"
var BASE_COVER_URL string = "https://covers.openlibrary.org/b/olid/%s-L.jpg"

func GetCoverIDs(title *string, author *string) ([]string, error) {
	if title == nil || author == nil {
		log.Error("[metadata] Invalid Search Query")
		return nil, errors.New("Invalid Query")
	}

	searchQuery := url.QueryEscape(fmt.Sprintf("%s %s", *title, *author))
	apiQuery := fmt.Sprintf(BASE_QUERY_URL, searchQuery)

	log.Info("[metadata] Acquiring CoverID")
	resp, err := http.Get(apiQuery)
	if err != nil {
		log.Error("[metadata] Cover URL API Failure")
		return nil, errors.New("API Failure")
	}

	target := queryResponse{}
	err = json.NewDecoder(resp.Body).Decode(&target)
	if err != nil {
		log.Error("[metadata] Cover URL API Decode Failure")
		return nil, errors.New("API Failure")
	}

	var coverIDs []string
	for _, result := range target.Results {
		if result.CoverEditionKey != "" {
			coverIDs = append(coverIDs, result.CoverEditionKey)
		}
	}

	return coverIDs, nil
}

func DownloadAndSaveCover(coverID string, dirPath string) (*string, error) {
	// Derive & Sanitize File Name
	fileName := "." + filepath.Clean(fmt.Sprintf("/%s.jpg", coverID))

	// Generate Storage Path
	safePath := filepath.Join(dirPath, "covers", fileName)

	// Validate File Doesn't Exists
	_, err := os.Stat(safePath)
	if err == nil {
		log.Warn("[metadata] File Alreads Exists")
		return &safePath, nil
	}

	// Create File
	out, err := os.Create(safePath)
	if err != nil {
		log.Error("[metadata] File Create Error")
		return nil, errors.New("File Failure")
	}
	defer out.Close()

	// Download File
	log.Info("[metadata] Downloading Cover")
	coverURL := fmt.Sprintf(BASE_COVER_URL, coverID)
	resp, err := http.Get(coverURL)
	if err != nil {
		log.Error("[metadata] Cover URL API Failure")
		return nil, errors.New("API Failure")
	}
	defer resp.Body.Close()

	// Copy File to Disk
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		log.Error("[metadata] File Copy Error")
		return nil, errors.New("File Failure")
	}

	// Return FilePath
	return &safePath, nil
}
