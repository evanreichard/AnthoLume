package search

import (
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	log "github.com/sirupsen/logrus"
)

const userAgent string = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0"

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
		downloadURL:       "http://library.lol/fiction/%s",
		parseSearchFunc:   parseLibGenFiction,
		parseDownloadFunc: parseLibGenDownloadURL,
	},
	SOURCE_LIBGEN_NON_FICTION: {
		searchURL:         "https://libgen.is/search.php?req=%s",
		downloadURL:       "http://library.lol/main/%s",
		parseSearchFunc:   parseLibGenNonFiction,
		parseDownloadFunc: parseLibGenDownloadURL,
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
		return "", errors.New("Download Failure")
	}

	// Create File
	tempFile, err := os.CreateTemp("", "book")
	if err != nil {
		log.Error("File Create Error: ", err)
		return "", errors.New("File Failure")
	}
	defer tempFile.Close()

	// Download File
	log.Info("Downloading Book: ", bookURL)
	resp, err := downloadBook(bookURL)
	if err != nil {
		os.Remove(tempFile.Name())
		log.Error("Book URL API Failure: ", err)
		return "", errors.New("API Failure")
	}
	defer resp.Body.Close()

	// Copy File to Disk
	log.Info("Saving Book")
	_, err = io.Copy(tempFile, resp.Body)
	if err != nil {
		os.Remove(tempFile.Name())
		log.Error("File Copy Error: ", err)
		return "", errors.New("File Failure")
	}

	return tempFile.Name(), nil
}

func GoodReadsMostRead(c Cadence) ([]SearchItem, error) {
	body, err := getPage("https://www.goodreads.com/book/most_read?category=all&country=US&duration=" + string(c))
	if err != nil {
		return nil, err
	}
	return parseGoodReads(body)
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
	client := http.Client{
		Timeout: 10 * time.Second,
	}

	// Get Page
	resp, err := client.Get(page)
	if err != nil {
		return nil, err
	}

	// Return Body
	return resp.Body, err
}

func parseLibGenFiction(body io.ReadCloser) ([]SearchItem, error) {
	// Parse
	defer body.Close()
	doc, err := goquery.NewDocumentFromReader(body)
	if err != nil {
		return nil, err
	}

	// Normalize Results
	var allEntries []SearchItem
	doc.Find("table.catalog tbody > tr").Each(func(ix int, rawBook *goquery.Selection) {

		// Parse File Details
		fileItem := rawBook.Find("td:nth-child(5)")
		fileDesc := fileItem.Text()
		fileDescSplit := strings.Split(fileDesc, "/")
		fileType := strings.ToLower(strings.TrimSpace(fileDescSplit[0]))
		fileSize := strings.TrimSpace(fileDescSplit[1])

		// Parse Upload Date
		uploadedRaw, _ := fileItem.Attr("title")
		uploadedDateRaw := strings.Split(uploadedRaw, "Uploaded at ")[1]
		uploadDate, _ := time.Parse("2006-01-02 15:04:05", uploadedDateRaw)

		// Parse MD5
		editHref, _ := rawBook.Find("td:nth-child(7) a").Attr("href")
		hrefArray := strings.Split(editHref, "/")
		id := hrefArray[len(hrefArray)-1]

		// Parse Other Details
		title := rawBook.Find("td:nth-child(3) p a").Text()
		author := rawBook.Find(".catalog_authors li a").Text()
		language := rawBook.Find("td:nth-child(4)").Text()
		series := rawBook.Find("td:nth-child(2)").Text()

		item := SearchItem{
			ID:         id,
			Title:      title,
			Author:     author,
			Series:     series,
			Language:   language,
			FileType:   fileType,
			FileSize:   fileSize,
			UploadDate: uploadDate.Format(time.RFC3339),
		}

		allEntries = append(allEntries, item)
	})

	// Return Results
	return allEntries, nil
}

func parseLibGenNonFiction(body io.ReadCloser) ([]SearchItem, error) {
	// Parse
	defer body.Close()
	doc, err := goquery.NewDocumentFromReader(body)
	if err != nil {
		return nil, err
	}

	// Normalize Results
	var allEntries []SearchItem
	doc.Find("table.c tbody > tr:nth-child(n + 2)").Each(func(ix int, rawBook *goquery.Selection) {

		// Parse Type & Size
		fileSize := strings.ToLower(strings.TrimSpace(rawBook.Find("td:nth-child(8)").Text()))
		fileType := strings.ToLower(strings.TrimSpace(rawBook.Find("td:nth-child(9)").Text()))

		// Parse MD5
		titleRaw := rawBook.Find("td:nth-child(3) [id]")
		editHref, _ := titleRaw.Attr("href")
		hrefArray := strings.Split(editHref, "?md5=")
		id := hrefArray[1]

		// Parse Other Details
		title := titleRaw.Text()
		author := rawBook.Find("td:nth-child(2)").Text()
		language := rawBook.Find("td:nth-child(7)").Text()
		series := rawBook.Find("td:nth-child(3) [href*='column=series']").Text()

		item := SearchItem{
			ID:       id,
			Title:    title,
			Author:   author,
			Series:   series,
			Language: language,
			FileType: fileType,
			FileSize: fileSize,
		}

		allEntries = append(allEntries, item)
	})

	// Return Results
	return allEntries, nil
}

func parseLibGenDownloadURL(body io.ReadCloser) (string, error) {
	// Parse
	defer body.Close()
	doc, _ := goquery.NewDocumentFromReader(body)

	// Return Download URL
	// downloadURL, _ := doc.Find("#download [href*=cloudflare]").Attr("href")
	downloadURL, exists := doc.Find("#download h2 a").Attr("href")
	if exists == false {
		return "", errors.New("Download URL not found")
	}

	return downloadURL, nil
}

func parseGoodReads(body io.ReadCloser) ([]SearchItem, error) {
	// Parse
	defer body.Close()
	doc, err := goquery.NewDocumentFromReader(body)
	if err != nil {
		return nil, err
	}

	// Normalize Results
	var allEntries []SearchItem

	doc.Find("[itemtype=\"http://schema.org/Book\"]").Each(func(ix int, rawBook *goquery.Selection) {
		title := rawBook.Find(".bookTitle span").Text()
		author := rawBook.Find(".authorName span").Text()

		item := SearchItem{
			Title:  title,
			Author: author,
		}

		allEntries = append(allEntries, item)
	})

	// Return Results
	return allEntries, nil
}

func parseAnnasArchiveDownloadURL(body io.ReadCloser) (string, error) {
	// Parse
	defer body.Close()
	doc, _ := goquery.NewDocumentFromReader(body)

	// Return Download URL
	downloadURL, exists := doc.Find("body > table > tbody > tr > td > a").Attr("href")
	if exists == false {
		return "", errors.New("Download URL not found")
	}

	// Possible Funky URL
	downloadURL = strings.ReplaceAll(downloadURL, "\\", "/")

	return downloadURL, nil
}

func parseAnnasArchive(body io.ReadCloser) ([]SearchItem, error) {
	// Parse
	defer body.Close()
	doc, err := goquery.NewDocumentFromReader(body)
	if err != nil {
		return nil, err
	}

	// Normalize Results
	var allEntries []SearchItem
	doc.Find("form > div.w-full > div.w-full > div > div.justify-center").Each(func(ix int, rawBook *goquery.Selection) {
		// Parse Details
		details := rawBook.Find("div:nth-child(2) > div:nth-child(1)").Text()
		detailsSplit := strings.Split(details, ", ")

		// Invalid Details
		if len(detailsSplit) < 3 {
			return
		}

		language := detailsSplit[0]
		fileType := detailsSplit[1]
		fileSize := detailsSplit[2]

		// Get Title & Author
		title := rawBook.Find("h3").Text()
		author := rawBook.Find("div:nth-child(2) > div:nth-child(4)").Text()

		// Parse MD5
		itemHref, _ := rawBook.Find("a").Attr("href")
		hrefArray := strings.Split(itemHref, "/")
		id := hrefArray[len(hrefArray)-1]

		item := SearchItem{
			ID:       id,
			Title:    title,
			Author:   author,
			Language: language,
			FileType: fileType,
			FileSize: fileSize,
		}

		allEntries = append(allEntries, item)
	})

	// Return Results
	return allEntries, nil
}

func downloadBook(bookURL string) (*http.Response, error) {
	// Allow Insecure
	client := &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}}

	// Start Request
	req, err := http.NewRequest("GET", bookURL, nil)
	if err != nil {
		return nil, err
	}

	// Set UserAgent
	req.Header.Set("User-Agent", userAgent)

	return client.Do(req)
}
