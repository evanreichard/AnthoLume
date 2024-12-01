package search

import (
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

func searchLibGenFiction(query string) ([]SearchItem, error) {
	searchURL := "https://libgen.is/fiction/?q=%s&language=English&format=epub"
	url := fmt.Sprintf(searchURL, url.QueryEscape(query))
	body, err := getPage(url)
	if err != nil {
		return nil, err
	}
	return parseLibGenFiction(body)
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

func searchLibGenNonFiction(query string) ([]SearchItem, error) {
	searchURL := "https://libgen.is/search.php?req=%s"
	url := fmt.Sprintf(searchURL, url.QueryEscape(query))
	body, err := getPage(url)
	if err != nil {
		return nil, err
	}
	return parseLibGenNonFiction(body)
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
