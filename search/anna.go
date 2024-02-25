package search

import (
	"fmt"
	"io"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

func parseAnnasArchiveDownloadURL(body io.ReadCloser) (string, error) {
	// Parse
	defer body.Close()
	doc, _ := goquery.NewDocumentFromReader(body)

	// Return Download URL
	downloadURL, exists := doc.Find("body > table > tbody > tr > td > a").Attr("href")
	if exists == false {
		return "", fmt.Errorf("Download URL not found")
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
