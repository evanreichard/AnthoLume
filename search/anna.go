package search

import (
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

func searchAnnasArchive(query string) ([]SearchItem, error) {
	searchURL := "https://annas-archive.li/search?index=&q=%s&ext=epub&sort=&lang=en"
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
