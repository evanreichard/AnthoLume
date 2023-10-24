package metadata

import (
	"testing"
)

func TestGetWordCount(t *testing.T) {
	var want int64 = 30477
	wordCount, err := countEPUBWords("./_test_files/alice.epub")

	if wordCount != want {
		t.Fatalf(`Expected: %v, Got: %v, Error: %v`, want, wordCount, err)
	}
}
