package metadata

import (
	"errors"
	"fmt"
	"path/filepath"

	"github.com/gabriel-vasile/mimetype"
)

type Source int

const (
	GBOOK Source = iota
	OLIB
)

type MetadataInfo struct {
	ID          *string
	Title       *string
	Author      *string
	Description *string
	ISBN10      *string
	ISBN13      *string
}

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

func SearchMetadata(s Source, metadataSearch MetadataInfo) ([]MetadataInfo, error) {
	switch s {
	case GBOOK:
		return getGBooksMetadata(metadataSearch)
	case OLIB:
		return nil, errors.New("Not implemented")
	default:
		return nil, errors.New("Not implemented")

	}
}

func GetWordCount(filepath string) (int64, error) {
	fileMime, err := mimetype.DetectFile(filepath)
	if err != nil {
		return 0, err
	}

	if fileExtension := fileMime.Extension(); fileExtension == ".epub" {
		totalWords, err := countEPUBWords(filepath)
		if err != nil {
			return 0, err
		}
		return totalWords, nil
	} else {
		return 0, errors.New("Invalid Extension")
	}
}
