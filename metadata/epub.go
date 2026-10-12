package metadata

import (
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"github.com/taylorskalyo/goreader/epub"
)

func openEPUB(path string) (*epub.Reader, *os.File, error) {
	if err := validateEPUBArchive(path); err != nil {
		return nil, nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	stat, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	r, err := epub.NewReader(f, stat.Size())
	if err != nil {
		f.Close()
		return nil, nil, fmt.Errorf("%w: %v", ErrInvalidDocument, err)
	}
	return r, f, nil
}

func getEPUBMetadata(filepath string) (*MetadataInfo, error) {
	rc, f, err := openEPUB(filepath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
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
	rc, f, err := openEPUB(filepath)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	rf := rc.Rootfiles[0]
	if len(rf.Itemrefs) > maxArchiveEntries {
		return 0, ErrArchiveTooLarge
	}
	var completeCount, totalBytes int64
	for _, item := range rf.Itemrefs {
		r, err := item.Open()
		if err != nil {
			return 0, fmt.Errorf("%w: %v", ErrInvalidDocument, err)
		}
		data, err := io.ReadAll(io.LimitReader(r, maxEPUBTextSize+1))
		r.Close()
		totalBytes += int64(len(data))
		if len(data) > maxEPUBTextSize || totalBytes > maxArchiveUncompressed {
			return 0, ErrArchiveTooLarge
		}
		if err != nil {
			return 0, fmt.Errorf("%w: %v", ErrInvalidDocument, err)
		}
		doc, err := goquery.NewDocumentFromReader(strings.NewReader(string(data)))
		if err != nil {
			return 0, fmt.Errorf("%w: %v", ErrInvalidDocument, err)
		}
		doc.Find("script, style, noscript, iframe").Remove()
		completeCount += int64(len(strings.Fields(doc.Text())))
	}
	return completeCount, nil
}
