package search

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	log "github.com/sirupsen/logrus"
)

type Cadence string

const (
	TOP_YEAR  Cadence = "y"
	TOP_MONTH Cadence = "m"
)

type BookType int

const (
	BOOK_FICTION BookType = iota
	BOOK_NON_FICTION
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

func SearchBook(query string, bookType BookType) (allEntries []SearchItem) {
	log.Info(query)
	if bookType == BOOK_FICTION {
		// Search Fiction
		url := "https://libgen.is/fiction/?q=" + url.QueryEscape(query) + "&language=English&format=epub"
		body := getPage(url)
		allEntries = parseLibGenFiction(body)
	} else if bookType == BOOK_NON_FICTION {
		// Search NonFiction
		url := "https://libgen.is/search.php?req=" + url.QueryEscape(query)
		body := getPage(url)
		allEntries = parseLibGenNonFiction(body)
	}

	return
}

func GoodReadsMostRead(c Cadence) []SearchItem {
	body := getPage("https://www.goodreads.com/book/most_read?category=all&country=US&duration=" + string(c))
	return parseGoodReads(body)
}

func GetBookURL(id string, bookType BookType) string {
	// Derive Info URL
	var infoURL string
	if bookType == BOOK_FICTION {
		infoURL = "http://library.lol/fiction/" + id
	} else if bookType == BOOK_NON_FICTION {
		infoURL = "http://library.lol/main/" + id
	}

	// Parse & Derive Download URL
	body := getPage(infoURL)

	// downloadURL := parseLibGenDownloadURL(body)
	return parseLibGenDownloadURL(body)
}

func SaveBook(id string, bookType BookType) (string, error) {
	// Derive Info URL
	var infoURL string
	if bookType == BOOK_FICTION {
		infoURL = "http://library.lol/fiction/" + id
	} else if bookType == BOOK_NON_FICTION {
		infoURL = "http://library.lol/main/" + id
	}

	// Parse & Derive Download URL
	body := getPage(infoURL)
	bookURL := parseLibGenDownloadURL(body)

	// Create File
	tempFile, err := os.CreateTemp("", "book")
	if err != nil {
		log.Error("[SaveBook] File Create Error: ", err)
		return "", errors.New("File Failure")
	}
	defer tempFile.Close()

	// Download File
	log.Info("[SaveBook] Downloading Book")
	resp, err := http.Get(bookURL)
	if err != nil {
		os.Remove(tempFile.Name())
		log.Error("[SaveBook] Cover URL API Failure")
		return "", errors.New("API Failure")
	}
	defer resp.Body.Close()

	// Copy File to Disk
	log.Info("[SaveBook] Saving Book")
	_, err = io.Copy(tempFile, resp.Body)
	if err != nil {
		os.Remove(tempFile.Name())
		log.Error("[SaveBook] File Copy Error")
		return "", errors.New("File Failure")
	}

	return tempFile.Name(), nil
}

func getPage(page string) io.ReadCloser {
	resp, _ := http.Get(page)
	return resp.Body
}

func parseLibGenFiction(body io.ReadCloser) []SearchItem {
	// Parse
	defer body.Close()
	doc, _ := goquery.NewDocumentFromReader(body)

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
	return allEntries
}

func parseLibGenNonFiction(body io.ReadCloser) []SearchItem {
	// Parse
	defer body.Close()
	doc, _ := goquery.NewDocumentFromReader(body)

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
	return allEntries
}

func parseLibGenDownloadURL(body io.ReadCloser) string {
	// Parse
	defer body.Close()
	doc, _ := goquery.NewDocumentFromReader(body)

	// Return Download URL
	// downloadURL, _ := doc.Find("#download [href*=cloudflare]").Attr("href")
	downloadURL, _ := doc.Find("#download h2 a").Attr("href")

	return downloadURL
}

func parseGoodReads(body io.ReadCloser) []SearchItem {
	// Parse
	defer body.Close()
	doc, _ := goquery.NewDocumentFromReader(body)

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
	return allEntries
}
