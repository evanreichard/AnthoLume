package search

import (
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"

	log "github.com/sirupsen/logrus"
)

const userAgent string = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0"

type Cadence string

const (
	CADENCE_TOP_YEAR  Cadence = "y"
	CADENCE_TOP_MONTH Cadence = "m"
)

type BookType int

const (
	BOOK_FICTION BookType = iota
	BOOK_NON_FICTION
)

type Source string

const (
	SOURCE_ANNAS_ARCHIVE      Source = "Annas Archive"
	SOURCE_LIBGEN_FICTION     Source = "LibGen Fiction"
	SOURCE_LIBGEN_NON_FICTION Source = "LibGen Non-fiction"
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

type sourceDef struct {
	searchURL         string
	downloadURL       string
	parseSearchFunc   func(io.ReadCloser) ([]SearchItem, error)
	parseDownloadFunc func(io.ReadCloser) (string, error)
}

var sourceDefs = map[Source]sourceDef{
	SOURCE_ANNAS_ARCHIVE: {
		searchURL:         "https://annas-archive.org/search?index=&q=%s&ext=epub&sort=&lang=en",
		downloadURL:       "http://libgen.li/ads.php?md5=%s",
		parseSearchFunc:   parseAnnasArchive,
		parseDownloadFunc: parseAnnasArchiveDownloadURL,
	},
	SOURCE_LIBGEN_FICTION: {
		searchURL:         "https://libgen.is/fiction/?q=%s&language=English&format=epub",
		downloadURL:       "http://libgen.li/ads.php?md5=%s",
		parseSearchFunc:   parseLibGenFiction,
		parseDownloadFunc: parseAnnasArchiveDownloadURL,
	},
	SOURCE_LIBGEN_NON_FICTION: {
		searchURL:         "https://libgen.is/search.php?req=%s",
		downloadURL:       "http://libgen.li/ads.php?md5=%s",
		parseSearchFunc:   parseLibGenNonFiction,
		parseDownloadFunc: parseAnnasArchiveDownloadURL,
	},
}

func SearchBook(query string, source Source) ([]SearchItem, error) {
	def := sourceDefs[source]
	log.Debug("Source: ", def)
	url := fmt.Sprintf(def.searchURL, url.QueryEscape(query))
	body, err := getPage(url)
	if err != nil {
		return nil, err
	}
	return def.parseSearchFunc(body)
}

func SaveBook(id string, source Source) (string, error) {
	def := sourceDefs[source]
	log.Debug("Source: ", def)
	url := fmt.Sprintf(def.downloadURL, id)

	body, err := getPage(url)
	if err != nil {
		return "", err
	}

	bookURL, err := def.parseDownloadFunc(body)
	if err != nil {
		log.Error("Parse Download URL Error: ", err)
		return "", fmt.Errorf("Download Failure")
	}

	// Create File
	tempFile, err := os.CreateTemp("", "book")
	if err != nil {
		log.Error("File Create Error: ", err)
		return "", fmt.Errorf("File Failure")
	}
	defer tempFile.Close()

	// Download File
	log.Info("Downloading Book: ", bookURL)
	resp, err := downloadBook(bookURL)
	if err != nil {
		os.Remove(tempFile.Name())
		log.Error("Book URL API Failure: ", err)
		return "", fmt.Errorf("API Failure")
	}
	defer resp.Body.Close()

	// Copy File to Disk
	log.Info("Saving Book")
	_, err = io.Copy(tempFile, resp.Body)
	if err != nil {
		os.Remove(tempFile.Name())
		log.Error("File Copy Error: ", err)
		return "", fmt.Errorf("File Failure")
	}

	return tempFile.Name(), nil
}

func GetBookURL(id string, bookType BookType) (string, error) {
	// Derive Info URL
	var infoURL string
	if bookType == BOOK_FICTION {
		infoURL = "http://library.lol/fiction/" + id
	} else if bookType == BOOK_NON_FICTION {
		infoURL = "http://library.lol/main/" + id
	}

	// Parse & Derive Download URL
	body, err := getPage(infoURL)
	if err != nil {
		return "", err
	}

	// downloadURL := parseLibGenDownloadURL(body)
	return parseLibGenDownloadURL(body)
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

	// Set User-Agent
	req.Header.Set("User-Agent", userAgent)

	// Do Request
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}

	// Return Body
	return resp.Body, err
}

func downloadBook(bookURL string) (*http.Response, error) {
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
		return nil, err
	}

	// Set User-Agent
	req.Header.Set("User-Agent", userAgent)

	return client.Do(req)
}
