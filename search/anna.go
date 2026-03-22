package search

import (
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

const ANNAS_ARCHIVE_SEARCH_URL = "https://%s/search?index=&q=%s&ext=epub&sort=&lang=en"

var annasArchiveDomains []string = []string{
	"annas-archive.gl",
	"annas-archive.pk",
	"annas-archive.gd",
}

func searchAnnasArchive(query string) ([]SearchItem, error) {
	var allErrors []error

	for _, domain := range annasArchiveDomains {
		url := fmt.Sprintf(ANNAS_ARCHIVE_SEARCH_URL, domain, url.QueryEscape(query))
		body, err := getPage(url)
		if err != nil {
			allErrors = append(allErrors, err)
			continue
		}

		parsedItem, err := parseAnnasArchive(body)
		if err != nil {
			allErrors = append(allErrors, err)
			continue
		}
		return parsedItem, nil
	}

	return nil, fmt.Errorf("could not query annas-archive: %w", errors.Join(allErrors...))
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
	doc.Find(".js-aarecord-list-outer > div > div").Each(func(ix int, rawBook *goquery.Selection) {

		// Parse Details
		details := rawBook.Find("div:nth-child(3)").Text()
		detailsSplit := strings.Split(details, " · ")

		// Invalid Details
		if len(detailsSplit) < 3 {
			return
		}

		// Parse MD5
		titleAuthorDetails := rawBook.Find("div a")
		titleEl := titleAuthorDetails.Eq(0)
		itemHref, _ := titleEl.Attr("href")
		hrefArray := strings.Split(itemHref, "/")
		id := hrefArray[len(hrefArray)-1]

		allEntries = append(allEntries, SearchItem{
			ID:       id,
			Title:    titleEl.Text(),
			Author:   titleAuthorDetails.Eq(1).Text(),
			Language: detailsSplit[0],
			FileType: detailsSplit[1],
			FileSize: detailsSplit[2],
		})
	})

	// Return Results
	return allEntries, nil
}
