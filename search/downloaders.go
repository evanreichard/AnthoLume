package search

import (
	"errors"
	"fmt"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

func getLibGenDownloadURL(md5 string, _ Source) ([]string, error) {
	// Get Page
	body, err := getPage("http://libgen.li/ads.php?md5=" + md5)
	if err != nil {
		return nil, err
	}
	defer body.Close()

	// Parse
	doc, err := goquery.NewDocumentFromReader(body)
	if err != nil {
		return nil, err
	}

	// Return Download URL
	downloadPath, exists := doc.Find("body > table > tbody > tr > td > a").Attr("href")
	if !exists {
		return nil, fmt.Errorf("Download URL not found")
	}

	// Possible Funky URL
	downloadPath = strings.ReplaceAll(downloadPath, "\\", "/")
	return []string{fmt.Sprintf("http://libgen.li/%s", downloadPath)}, nil
}

func getLibraryDownloadURL(md5 string, source Source) ([]string, error) {
	// Derive Info URL
	var infoURL string
	switch source {
	case SOURCE_LIBGEN_FICTION, SOURCE_ANNAS_ARCHIVE:
		infoURL = "http://library.lol/fiction/" + md5
	case SOURCE_LIBGEN_NON_FICTION:
		infoURL = "http://library.lol/main/" + md5
	default:
		return nil, errors.New("invalid source")
	}

	// Get Page
	body, err := getPage(infoURL)
	if err != nil {
		return nil, err
	}
	defer body.Close()

	// Parse
	doc, err := goquery.NewDocumentFromReader(body)
	if err != nil {
		return nil, err
	}

	// Return Download URL
	// downloadURL, _ := doc.Find("#download [href*=cloudflare]").Attr("href")
	downloadURL, exists := doc.Find("#download h2 a").Attr("href")
	if !exists {
		return nil, errors.New("Download URL not found")
	}

	return []string{downloadURL}, nil
}
