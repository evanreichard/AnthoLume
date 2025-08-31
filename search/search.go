package search

import (
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/metadata"
)

const userAgent string = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

type Cadence string

const (
	CADENCE_TOP_YEAR  Cadence = "y"
	CADENCE_TOP_MONTH Cadence = "m"
)

type Source string

const (
	SourceAnnasArchive Source = "Annas Archive"
	SourceLibGen       Source = "LibGen"
)

type SearchItem struct {
	ID         string
	Title      string
	Author     string
	Language   string
	Series     string
	FileType   string
	FileSize   string
	UploadDate string
}

type searchFunc func(query string) (searchResults []SearchItem, err error)
type downloadFunc func(md5 string, source Source) (downloadURL []string, err error)

var searchDefs = map[Source]searchFunc{
	SourceAnnasArchive: searchAnnasArchive,
	SourceLibGen:       searchLibGen,
}

var downloadFuncs = []downloadFunc{
	getLibGenDownloadURL,
	getLibraryDownloadURL,
}

func SearchBook(query string, source Source) ([]SearchItem, error) {
	searchFunc, found := searchDefs[source]
	if !found {
		return nil, fmt.Errorf("invalid source: %s", source)
	}
	return searchFunc(query)
}

func SaveBook(md5 string, source Source, progressFunc func(float32)) (string, *metadata.MetadataInfo, error) {
	for _, f := range downloadFuncs {
		downloadURLs, err := f(md5, source)
		if err != nil {
			log.Error("failed to acquire download urls")
			continue
		}

		for _, bookURL := range downloadURLs {
			// Download File
			log.Info("Downloading Book: ", bookURL)
			fileName, err := downloadBook(bookURL, progressFunc)
			if err != nil {
				log.Error("Book URL API Failure: ", err)
				continue
			}

			// Get Metadata
			metadata, err := metadata.GetMetadata(fileName)
			if err != nil {
				log.Error("Book Metadata Failure: ", err)
				continue
			}

			return fileName, metadata, nil
		}
	}

	return "", nil, errors.New("failed to download book")
}

func getPage(page string) (io.ReadCloser, error) {
	log.Debug("URL: ", page)

	// Set 10s Timeout
	client := http.Client{Timeout: 10 * time.Second}

	// Start Request
	req, err := http.NewRequest("GET", page, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)

	// Do Request
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	// Return Body
	return resp.Body, err
}

func downloadBook(bookURL string, progressFunc func(float32)) (string, error) {
	log.Debug("URL: ", bookURL)

	// Allow Insecure
	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}

	// Start Request
	req, err := http.NewRequest("GET", bookURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)

	// Perform API Request
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}

	// Create File
	tempFile, err := os.CreateTemp("", "book")
	if err != nil {
		log.Error("File Create Error: ", err)
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	defer tempFile.Close()

	// Copy File to Disk
	log.Info("Saving Book")
	counter := &writeCounter{Total: resp.ContentLength, ProgressFunction: progressFunc}
	_, err = io.Copy(tempFile, io.TeeReader(resp.Body, counter))
	if err != nil {
		os.Remove(tempFile.Name())
		log.Error("File Copy Error: ", err)
		return "", fmt.Errorf("failed to copy response to temp file: %w", err)
	}

	return tempFile.Name(), nil
}
