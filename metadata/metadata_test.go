package metadata

import (
	"testing"
)

func TestGetWordCount(t *testing.T) {
	var want int64 = 30477
	wordCount, err := countEPUBWords("../_test_files/alice.epub")

	if wordCount != want {
		t.Fatalf(`Expected: %v, Got: %v, Error: %v`, want, wordCount, err)
	}
}

func TestGetMetadata(t *testing.T) {
	metadataInfo, err := getEPUBMetadata("../_test_files/alice.epub")
	if err != nil {
		t.Fatalf(`Expected: *MetadataInfo, Got: nil, Error: %v`, err)
	}

	want := "Alice's Adventures in Wonderland / Illustrated by Arthur Rackham. With a Proem by Austin Dobson"
	if *metadataInfo.Title != want {
		t.Fatalf(`Expected: %v, Got: %v, Error: %v`, want, *metadataInfo.Title, err)
	}

	want = "Lewis Carroll"
	if *metadataInfo.Author != want {
		t.Fatalf(`Expected: %v, Got: %v, Error: %v`, want, *metadataInfo.Author, err)
	}

	want = ""
	if *metadataInfo.Description != want {
		t.Fatalf(`Expected: %v, Got: %v, Error: %v`, want, *metadataInfo.Description, err)
	}
}
