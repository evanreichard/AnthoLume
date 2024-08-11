package search

import (
	"fmt"
	"io"
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

var commentRE = regexp.MustCompile(`(?s)<!--(.*?)-->`)

func parseAnnasArchiveDownloadURL(body io.ReadCloser) (string, error) {
	// Parse
	defer body.Close()
	doc, _ := goquery.NewDocumentFromReader(body)

	// Return Download URL
	downloadURL, exists := doc.Find("body > table > tbody > tr > td > a").Attr("href")
	if !exists {
		return "", fmt.Errorf("Download URL not found")
	}

	// Possible Funky URL
	downloadURL = strings.ReplaceAll(downloadURL, "\\", "/")

	return downloadURL, nil
}

// getAnnasArchiveBookSelection parses potentially commented out HTML. For some reason
// Annas Archive comments out blocks "below the fold". They aren't rendered until you
// scroll. This attempts to parse the commented out HTML.
func getAnnasArchiveBookSelection(rawBook *goquery.Selection) *goquery.Selection {
	rawHTML, err := rawBook.Html()
	if err != nil {
		return rawBook
	}

	strippedHTML := strings.TrimSpace(rawHTML)
	if !strings.HasPrefix(strippedHTML, "<!--") || !strings.HasSuffix(strippedHTML, "-->") {
		return rawBook
	}

	allMatches := commentRE.FindAllStringSubmatch(strippedHTML, -1)
	if len(allMatches) != 1 || len(allMatches[0]) != 2 {
		return rawBook
	}

	captureGroup := allMatches[0][1]
	docReader := strings.NewReader(captureGroup)
	doc, err := goquery.NewDocumentFromReader(docReader)
	if err != nil {
		return rawBook
	}

	return doc.Selection
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
		rawBook = getAnnasArchiveBookSelection(rawBook)

		// Parse Details
		details := rawBook.Find("div:nth-child(2) > div:nth-child(1)").Text()
		detailsSplit := strings.Split(details, ", ")

		// Invalid Details
		if len(detailsSplit) < 4 {
			return
		}

		language := detailsSplit[0]
		fileType := detailsSplit[1]
		fileSize := detailsSplit[3]

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
