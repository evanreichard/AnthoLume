package metadata

import (
	"io"
	"strings"

	"github.com/taylorskalyo/goreader/epub"
	"golang.org/x/net/html"
)

func getEPUBMetadata(filepath string) (*MetadataInfo, error) {
	rc, err := epub.OpenReader(filepath)
	if err != nil {
		return nil, err
	}
	rf := rc.Rootfiles[0]

	return &MetadataInfo{
		Title:       &rf.Title,
		Author:      &rf.Creator,
		Description: &rf.Description,
	}, nil
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
		tokenizer := html.NewTokenizer(f)
		newCount, err := countTokenizerWords(*tokenizer)
		if err != nil {
			return 0, err
		}
		completeCount = completeCount + newCount
	}

	return completeCount, nil
}

func countTokenizerWords(tokenizer html.Tokenizer) (int64, error) {
	var err error
	var totalWords int64
	for {
		tokenType := tokenizer.Next()
		token := tokenizer.Token()
		if tokenType == html.TextToken {
			currStr := string(token.Data)
			totalWords = totalWords + int64(len(strings.Fields(currStr)))
		} else if tokenType == html.ErrorToken {
			err = tokenizer.Err()
		}
		if err == io.EOF {
			return totalWords, nil
		} else if err != nil {
			return 0, err
		}
	}
}
