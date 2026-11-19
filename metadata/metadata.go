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
	ID         *string
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

// Returns the word count of the provided filepath. An error will be returned
// if the file is not supported.
func GetWordCount(filepath string) (*int64, error) {
	totalWords, err := countEPUBWords(filepath)
	if err != nil {
		return nil, err
	}
	return &totalWords, nil
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

// Returns the extension of the provided filepath (e.g. ".epub"). An error
// will be returned if the file is not supported.
func GetDocumentType(filepath string) (*DocumentType, error) {
	docType, err := detectDocumentType(filepath)
	if err != nil {
		return nil, err
	}
	return &docType, nil
}

// Returns the extension of the provided file reader (e.g. ".epub"). An error
// will be returned if the file is not supported.
func GetDocumentTypeReader(r io.Reader) (*DocumentType, error) {
	f, err := os.CreateTemp("", "antholume-detect-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	n, err := io.Copy(f, io.LimitReader(r, MaxDocumentSize+1))
	if err != nil {
		return nil, err
	}
	if n > MaxDocumentSize {
		return nil, ErrArchiveTooLarge
	}
	return GetDocumentType(f.Name())
}

// Given a filetype string, attempt to resolve a DocumentType
func ParseDocumentType(input string) (DocumentType, bool) {
	validTypes := map[string]DocumentType{
		string(TYPE_EPUB): TYPE_EPUB,
	}
	found, ok := validTypes[input]
	return found, ok
}
