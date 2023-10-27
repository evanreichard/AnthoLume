package metadata

import (
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
		doc, _ := goquery.NewDocumentFromReader(f)
		completeCount = completeCount + int64(len(strings.Fields(doc.Text())))
	}

	return completeCount, nil
}
