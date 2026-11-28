package shelfmark

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode"

	"reichard.io/antholume/metadata"
)

var titleISBN = regexp.MustCompile(`\b(?:[0-9][- ]?){12}[0-9]\b|\b(?:[0-9][- ]?){9}[0-9Xx]\b`)

type releaseMatcher struct {
	title     string
	authors   []string
	isbns     map[string]bool
	fullTitle string
	series    seriesMetadata
	bylines   map[string]bool
	language  string
}

func newReleaseMatcher(book metadataBook) releaseMatcher {
	m := releaseMatcher{
		title: matchText(book.Title), language: strings.TrimSpace(book.Language), series: book.seriesMetadata,
		isbns: make(map[string]bool), bylines: make(map[string]bool),
	}
	m.fullTitle = m.title
	if subtitle := matchText(book.Subtitle); m.title != "" && subtitle != "" && !containsPhrase(m.title, subtitle) {
		m.fullTitle += " " + subtitle
	}
	for _, name := range book.Authors {
		if author := matchText(name); author != "" {
			m.authors = append(m.authors, author)
			m.bylines[author] = true
			m.bylines[authorName(name)] = true
		}
	}
	for _, value := range []string{book.ISBN10, book.ISBN13} {
		isbn := metadata.MatcherISBN(value)
		if metadata.ValidMatcherISBN(isbn) {
			for _, equivalent := range metadata.MatcherISBNs(isbn) {
				m.isbns[equivalent] = true
			}
		}
	}
	return m
}

func matchText(s string) string {
	return strings.Join(strings.FieldsFunc(strings.ToLower(s), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r) && !unicode.IsMark(r)
	}), " ")
}

func containsPhrase(text, phrase string) bool {
	return phrase != "" && strings.Contains(" "+text+" ", " "+phrase+" ")
}

func (m releaseMatcher) score(item verifiedRelease, isbn isbnEvidence) int {
	title, author := matchText(item.release.Title), matchText(item.release.Author)
	score := 0
	switch {
	case m.title != "" && title == m.title:
		score = 6
	case containsPhrase(title, m.title):
		score = 4
	}
	// Byline Evidence - A decorated title with its author beats an exact title alone, but author alone never beats title.
	for _, name := range m.authors {
		if containsPhrase(author, name) || containsPhrase(title, name) {
			score += 3
			break
		}
	}
	if isbn.inTitle || isbn.structured {
		score += 10
	}
	return score
}

type isbnEvidence struct {
	inTitle, structured, conflict bool
}

func (m releaseMatcher) isbnEvidence(item verifiedRelease) (e isbnEvidence) {
	if len(m.isbns) == 0 {
		return e
	}
	check := func(value string, matched *bool) {
		isbn := metadata.MatcherISBN(value)
		if m.isbns[isbn] {
			*matched = true
		} else if metadata.ValidMatcherISBN(isbn) {
			e.conflict = true
		}
	}
	for _, value := range titleISBN.FindAllString(item.release.Title, -1) {
		check(value, &e.inTitle)
	}
	var info struct {
		ISBN10 []string `json:"ISBN-10"`
		ISBN13 []string `json:"ISBN-13"`
	}
	if len(item.info) != 0 && json.Unmarshal(item.info, &info) == nil {
		for _, value := range append(info.ISBN10, info.ISBN13...) {
			check(value, &e.structured)
		}
	}
	return e
}
