//go:build integration

package metadata

import (
	"testing"
)

func TestGBooksGBIDMetadata(t *testing.T) {
	GBID := "ZxwpakTv_MIC"
	metadataResp, err := getGBooksMetadata(MetadataInfo{
		ID: &GBID,
	})

	if len(metadataResp) != 1 {
		t.Fatalf(`Expected: %v, Got: %v, Error: %v`, 1, len(metadataResp), err)
	}

	mResult := metadataResp[0]
	validateResult(&mResult, t)
}

func TestGBooksISBNQuery(t *testing.T) {
	ISBN10 := "1877527815"
	metadataResp, err := getGBooksMetadata(MetadataInfo{
		ISBN10: &ISBN10,
	})

	if len(metadataResp) != 1 {
		t.Fatalf(`Expected: %v, Got: %v, Error: %v`, 1, len(metadataResp), err)
	}

	mResult := metadataResp[0]
	validateResult(&mResult, t)
}

func TestGBooksTitleQuery(t *testing.T) {
	title := "Alice in Wonderland 1877527815"
	metadataResp, err := getGBooksMetadata(MetadataInfo{
		Title: &title,
	})

	if len(metadataResp) == 0 {
		t.Fatalf(`Expected: %v, Got: %v, Error: %v`, "> 0", len(metadataResp), err)
	}

	mResult := metadataResp[0]
	validateResult(&mResult, t)
}

func validateResult(m *MetadataInfo, t *testing.T) {
	expect := "Lewis Carroll"
	if *m.Author != expect {
		t.Fatalf(`Expected: %v, Got: %v`, expect, *m.Author)
	}

	expect = "Alice in Wonderland"
	if *m.Title != expect {
		t.Fatalf(`Expected: %v, Got: %v`, expect, *m.Title)
	}

	expect = "Alice in Wonderland (also known as Alice's Adventures in Wonderland), from 1865, is the peculiar and imaginative tale of a girl who falls down a rabbit-hole into a bizarre world of eccentric and unusual creatures. Lewis Carroll's prominent example of the genre of \"literary nonsense\" has endured in popularity with its clever way of playing with logic and a narrative structure that has influence generations of fiction writing."
	if *m.Description != expect {
		t.Fatalf(`Expected: %v, Got: %v`, expect, *m.Description)
	}

	expect = "1877527815"
	if *m.ISBN10 != expect {
		t.Fatalf(`Expected: %v, Got: %v`, expect, *m.ISBN10)
	}

	expect = "9781877527814"
	if *m.ISBN13 != expect {
		t.Fatalf(`Expected: %v, Got: %v`, expect, *m.ISBN13)
	}
}
