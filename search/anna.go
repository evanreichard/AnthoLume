package search

import (
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

var commentRE = regexp.MustCompile(`(?s)<!--(.*?)-->`)

func searchAnnasArchive(query string) ([]SearchItem, error) {
	searchURL := "https://annas-archive.org/search?index=&q=%s&ext=epub&sort=&lang=en"
	url := fmt.Sprintf(searchURL, url.QueryEscape(query))
	body, err := getPage(url)
	if err != nil {
		return nil, err
	}
	return parseAnnasArchive(body)
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
	doc.Find("#aarecord-list > div.justify-center").Each(func(ix int, rawBook *goquery.Selection) {
		rawBook = getAnnasArchiveBookSelection(rawBook)

		// Parse Details
		details := rawBook.Find("div:nth-child(2) > div:nth-child(1)").Text()
		detailsSplit := strings.Split(details, ", ")

		// Invalid Details
		if len(detailsSplit) < 4 {
			return
		}

		// Parse MD5
		itemHref, _ := rawBook.Find("a").Attr("href")
		hrefArray := strings.Split(itemHref, "/")
		id := hrefArray[len(hrefArray)-1]

		allEntries = append(allEntries, SearchItem{
			ID:       id,
			Title:    rawBook.Find("h3").First().Text(),
			Author:   rawBook.Find("div:nth-child(2) > div:nth-child(4)").First().Text(),
			Language: detailsSplit[0],
			FileType: detailsSplit[1],
			FileSize: detailsSplit[3],
		})
	})

	// Return Results
	return allEntries, nil
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
