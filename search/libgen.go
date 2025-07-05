package search

import (
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

const LIBGEN_SEARCH_URL = "https://%s/index.php?req=ext:epub+%s&gmode=on"

var libgenDomains []string = []string{
	"libgen.vg",
	"libgen.is",
}

func searchLibGen(query string) ([]SearchItem, error) {
	var allErrors []error

	for _, domain := range libgenDomains {
		url := fmt.Sprintf(LIBGEN_SEARCH_URL, domain, url.QueryEscape(query))
		body, err := getPage(url)
		if err != nil {
			allErrors = append(allErrors, err)
			continue
		}
		results, err := parseLibGen(body)
		if err != nil {
			allErrors = append(allErrors, err)
			continue
		}
		return results, nil
	}

	return nil, fmt.Errorf("could not query libgen: %w", errors.Join(allErrors...))
}

func parseLibGen(body io.ReadCloser) ([]SearchItem, error) {
	// Parse
	defer body.Close()
	doc, err := goquery.NewDocumentFromReader(body)
	if err != nil {
		return nil, err
	}

	// Normalize Results
	var allEntries []SearchItem
	doc.Find("#tablelibgen tbody > tr").Each(func(ix int, rawBook *goquery.Selection) {
		// Parse MD5
		linksRaw := rawBook.Find("td:nth-child(9) a")
		linksHref, _ := linksRaw.Attr("href")
		hrefArray := strings.Split(linksHref, "?md5=")
		if len(hrefArray) == 0 {
			return
		}
		id := hrefArray[1]

		allEntries = append(allEntries, SearchItem{
			ID:       id,
			Title:    rawBook.Find("td:nth-child(1) > a").First().Text(),
			Author:   rawBook.Find("td:nth-child(2)").Text(),
			Series:   rawBook.Find("td:nth-child(1) > b").Text(),
			Language: rawBook.Find("td:nth-child(5)").Text(),
			FileType: strings.ToLower(strings.TrimSpace(rawBook.Find("td:nth-child(8)").Text())),
			FileSize: strings.ToLower(strings.TrimSpace(rawBook.Find("td:nth-child(7)").Text())),
		})
	})

	// Return Results
	return allEntries, nil
}
