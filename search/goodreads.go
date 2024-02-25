package search

import (
	"io"

	"github.com/PuerkitoBio/goquery"
)

func GoodReadsMostRead(c Cadence) ([]SearchItem, error) {
	body, err := getPage("https://www.goodreads.com/book/most_read?category=all&country=US&duration=" + string(c))
	if err != nil {
		return nil, err
	}
	return parseGoodReads(body)
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
