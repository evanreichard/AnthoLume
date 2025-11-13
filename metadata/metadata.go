package metadata

import (
	"errors"
	"fmt"
	"io"
	"path/filepath"

	"github.com/gabriel-vasile/mimetype"
	"reichard.io/antholume/utils"
)

type MetadataHandler func(string) (*MetadataInfo, error)

type DocumentType string

const (
	TYPE_EPUB DocumentType = ".epub"
)

var extensionHandlerMap = map[DocumentType]MetadataHandler{
	TYPE_EPUB: getEPUBMetadata,
}

type Source int

const (
	SOURCE_GBOOK Source = iota
	SOURCE_OLIB
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

// Downloads the Google Books cover file and saves it to the provided directory.
func CacheCover(gbid string, coverDir string, documentID string, overwrite bool) (*string, error) {
	// Get Filepath
	coverFile := "." + filepath.Clean(fmt.Sprintf("/%s.jpg", documentID))
	coverFilePath := filepath.Join(coverDir, coverFile)

	// Save Google Books
	if err := saveGBooksCover(gbid, coverFilePath, overwrite); err != nil {
		return nil, err
	}

	// TODO - Refactor & Allow Open Library / Alternative Sources

	return &coverFile, nil
}

// Searches source for metadata based on the provided information.
func SearchMetadata(s Source, metadataSearch MetadataInfo) ([]MetadataInfo, error) {
	switch s {
	case SOURCE_GBOOK:
		return getGBooksMetadata(metadataSearch)
	case SOURCE_OLIB:
		return nil, errors.New("not implemented")
	default:
		return nil, errors.New("not implemented")

	}
}

// Returns the word count of the provided filepath. An error will be returned
// if the file is not supported.
func GetWordCount(filepath string) (*int64, error) {
	fileMime, err := mimetype.DetectFile(filepath)
	if err != nil {
		return nil, err
	}

	if fileExtension := fileMime.Extension(); fileExtension == ".epub" {
		totalWords, err := countEPUBWords(filepath)
		if err != nil {
			return nil, err
		}
		return &totalWords, nil
	} else {
		return nil, fmt.Errorf("invalid extension: %s", fileExtension)
	}
}

// Returns embedded metadata of the provided file. An error will be returned if
// the file is not supported.
func GetMetadata(filepath string) (*MetadataInfo, error) {
	// Detect Extension Type
	fileMime, err := mimetype.DetectFile(filepath)
	if err != nil {
		return nil, err
	}

	// Get Extension Type Metadata Handler
	fileExtension := fileMime.Extension()
	handler, ok := extensionHandlerMap[DocumentType(fileExtension)]
	if !ok {
		return nil, fmt.Errorf("invalid extension %s", fileExtension)
	}

	// Acquire Metadata
	metadataInfo, err := handler(filepath)
	if err != nil {
		return nil, fmt.Errorf("unable to acquire metadata")
	}

	// Calculate MD5 & Partial MD5
	partialMD5, err := utils.CalculatePartialMD5(filepath)
	if err != nil {
		return nil, fmt.Errorf("unable to calculate partial MD5")
	}

	// Calculate Actual MD5
	MD5, err := utils.CalculateMD5(filepath)
	if err != nil {
		return nil, fmt.Errorf("unable to calculate MD5")
	}

	// Calculate Word Count
	wordCount, err := GetWordCount(filepath)
	if err != nil {
		return nil, fmt.Errorf("unable to calculate word count")
	}

	metadataInfo.WordCount = wordCount
	metadataInfo.PartialMD5 = partialMD5
	metadataInfo.MD5 = MD5

	return metadataInfo, nil
}

// Returns the extension of the provided filepath (e.g. ".epub"). An error
// will be returned if the file is not supported.
func GetDocumentType(filepath string) (*DocumentType, error) {
	// Detect Extension Type
	fileMime, err := mimetype.DetectFile(filepath)
	if err != nil {
		return nil, err
	}

	// Detect
	fileExtension := fileMime.Extension()
	docType, ok := ParseDocumentType(fileExtension)
	if !ok {
		return nil, fmt.Errorf("filetype not supported")
	}

	return &docType, nil
}

// Returns the extension of the provided file reader (e.g. ".epub"). An error
// will be returned if the file is not supported.
func GetDocumentTypeReader(r io.Reader) (*DocumentType, error) {
	// Detect Extension Type
	fileMime, err := mimetype.DetectReader(r)
	if err != nil {
		return nil, err
	}

	// Detect
	fileExtension := fileMime.Extension()
	docType, ok := ParseDocumentType(fileExtension)
	if !ok {
		return nil, fmt.Errorf("filetype not supported")
	}

	return &docType, nil
}

// Given a filetype string, attempt to resolve a DocumentType
func ParseDocumentType(input string) (DocumentType, bool) {
	validTypes := map[string]DocumentType{
		string(TYPE_EPUB): TYPE_EPUB,
	}
	found, ok := validTypes[input]
	return found, ok
}
