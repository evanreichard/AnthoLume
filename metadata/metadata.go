package metadata

import (
	"io"
	"os"

	"reichard.io/antholume/utils"
)

type DocumentType string

const (
	TYPE_EPUB DocumentType = ".epub"
)

type MetadataInfo struct {
	MD5        *string
	PartialMD5 *string
	WordCount  *int64

	Title       *string
	Author      *string
	Description *string
	ISBN10      *string
	ISBN13      *string
	Type        DocumentType
}

// Returns embedded metadata of the provided file. An error will be returned if
// the file is not supported.
func GetMetadata(filepath string) (*MetadataInfo, error) {
	f, err := os.Open(filepath)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return GetOpenedMetadata(f)
}

func GetOpenedMetadata(f *os.File) (*MetadataInfo, error) {
	stat, err := f.Stat()
	if err != nil {
		return nil, err
	}
	book, err := readEPUB(f)
	if err != nil {
		return nil, err
	}
	metadataInfo := epubMetadata(book)
	partialMD5, err := utils.CalculatePartialMD5Reader(f)
	if err != nil {
		return nil, err
	}
	MD5, err := utils.CalculateMD5Reader(io.NewSectionReader(f, 0, stat.Size()))
	if err != nil {
		return nil, err
	}
	wordCount, err := epubWords(book)
	if err != nil {
		return nil, err
	}

	metadataInfo.WordCount = &wordCount
	metadataInfo.PartialMD5 = partialMD5
	metadataInfo.MD5 = MD5

	return metadataInfo, nil
}
