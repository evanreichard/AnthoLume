package utils

import "testing"

func TestCalculatePartialMD5(t *testing.T) {
	partialMD5, err := CalculatePartialMD5("../_test_files/alice.epub")

	want := "386d1cb51fe4a72e5c9fdad5e059bad9"
	if partialMD5 != want {
		t.Fatalf(`Expected: %v, Got: %v, Error: %v`, want, partialMD5, err)
	}
}
