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

type oLibCoverResult struct {
	CoverEditionKey string `json:"cover_edition_key"`
}

type oLibQueryResponse struct {
	ResultCount      int               `json:"numFound"`
	Start            int               `json:"start"`
	ResultCountExact bool              `json:"numFoundExact"`
	Results          []oLibCoverResult `json:"docs"`
}

const OLIB_QUERY_URL string = "https://openlibrary.org/search.json?q=%s&fields=cover_edition_key"
const OLIB_OLID_COVER_URL string = "https://covers.openlibrary.org/b/olid/%s-L.jpg"
const OLIB_ISBN_COVER_URL string = "https://covers.openlibrary.org/b/isbn/%s-L.jpg"
const OLIB_OLID_LINK_URL string = "https://openlibrary.org/books/%s"
const OLIB_ISBN_LINK_URL string = "https://openlibrary.org/isbn/%s"

func GetCoverOLIDs(title *string, author *string) ([]string, error) {
	if title == nil || author == nil {
		log.Error("Invalid Search Query")
		return nil, errors.New("Invalid Query")
	}

	searchQuery := url.QueryEscape(fmt.Sprintf("%s %s", *title, *author))
	apiQuery := fmt.Sprintf(OLIB_QUERY_URL, searchQuery)

	log.Info("Acquiring CoverID")
	resp, err := http.Get(apiQuery)
	if err != nil {
		log.Error("Cover URL API Failure")
		return nil, errors.New("API Failure")
	}

	target := oLibQueryResponse{}
	err = json.NewDecoder(resp.Body).Decode(&target)
	if err != nil {
		log.Error("Cover URL API Decode Failure")
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
		log.Warn("File Alreads Exists")
		return &safePath, nil
	}

	// Create File
	out, err := os.Create(safePath)
	if err != nil {
		log.Error("File Create Error")
		return nil, errors.New("File Failure")
	}
	defer out.Close()

	// Download File
	log.Info("Downloading Cover")
	coverURL := fmt.Sprintf(OLIB_OLID_COVER_URL, coverID)
	resp, err := http.Get(coverURL)
	if err != nil {
		log.Error("Cover URL API Failure")
		return nil, errors.New("API Failure")
	}
	defer resp.Body.Close()

	// Copy File to Disk
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		log.Error("File Copy Error")
		return nil, errors.New("File Failure")
	}

	// Return FilePath
	return &safePath, nil
}
