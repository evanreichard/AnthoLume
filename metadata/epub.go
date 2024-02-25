package metadata

import (
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/taylorskalyo/goreader/epub"
)

func getEPUBMetadata(filepath string) (*MetadataInfo, error) {
	rc, err := epub.OpenReader(filepath)
	if err != nil {
		return nil, err
	}
	rf := rc.Rootfiles[0]

	parsedMetadata := &MetadataInfo{
		Type:        TYPE_EPUB,
		Title:       &rf.Title,
		Author:      &rf.Creator,
		Description: &rf.Description,
	}

	// Parse Possible ISBN
	if rf.Source != "" {
		replaceRE := regexp.MustCompile(`[-\s]`)
		possibleISBN := replaceRE.ReplaceAllString(rf.Source, "")

		// ISBN Matches
		isbn13RE := regexp.MustCompile(`(?P<ISBN>\d{13})`)
		isbn10RE := regexp.MustCompile(`(?P<ISBN>\d{10})`)
		isbn13Matches := isbn13RE.FindStringSubmatch(possibleISBN)
		isbn10Matches := isbn10RE.FindStringSubmatch(possibleISBN)

		if len(isbn13Matches) > 0 {
			isbnIndex := isbn13RE.SubexpIndex("ISBN")
			parsedMetadata.ISBN13 = &isbn13Matches[isbnIndex]
		} else if len(isbn10Matches) > 0 {
			isbnIndex := isbn10RE.SubexpIndex("ISBN")
			parsedMetadata.ISBN10 = &isbn10Matches[isbnIndex]
		}
	}

	return parsedMetadata, nil
}

func countEPUBWords(filepath string) (int64, error) {
	rc, err := epub.OpenReader(filepath)
	if err != nil {
		return 0, err
	}
	rf := rc.Rootfiles[0]

	var completeCount int64
	for _, item := range rf.Spine.Itemrefs {
		f, _ := item.Open()
		doc, _ := goquery.NewDocumentFromReader(f)
		completeCount = completeCount + int64(len(strings.Fields(doc.Text())))
	}

	return completeCount, nil
}
