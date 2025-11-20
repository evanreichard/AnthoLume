package metadata

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGetWordCount(t *testing.T) {
	var desiredCount int64 = 30070
	actualCount, err := countEPUBWords("../_test_files/alice.epub")

	assert.Nil(t, err, "should have no error")
	assert.Equal(t, desiredCount, actualCount, "should be correct word count")

}

func TestGetMetadata(t *testing.T) {
	desiredTitle := "Alice's Adventures in Wonderland / Illustrated by Arthur Rackham. With a Proem by Austin Dobson"
	desiredAuthor := "Lewis Carroll"
	desiredDescription := ""

	metadataInfo, err := GetMetadata("../_test_files/alice.epub")

	assert.Nil(t, err, "should have no error")
	assert.Equal(t, desiredTitle, *metadataInfo.Title, "should be correct title")
	assert.Equal(t, desiredAuthor, *metadataInfo.Author, "should be correct author")
	assert.Equal(t, desiredDescription, *metadataInfo.Description, "should be correct author")
	assert.Equal(t, TYPE_EPUB, metadataInfo.Type, "should be correct type")
}

func TestGetExtension(t *testing.T) {
	docType, err := GetDocumentType("../_test_files/alice.epub")

	assert.Nil(t, err, "should have no error")
	assert.Equal(t, TYPE_EPUB, *docType)
}

func TestGetExtensionReader(t *testing.T) {
	file, _ := os.Open("../_test_files/alice.epub")
	docType, err := GetDocumentTypeReader(file)

	assert.Nil(t, err, "should have no error")
	assert.Equal(t, TYPE_EPUB, *docType)
}
