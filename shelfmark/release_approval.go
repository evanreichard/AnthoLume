package shelfmark

import (
	"encoding/json"
	"regexp"
	"strings"

	"reichard.io/antholume/metadata"
)

const ebookFormats = `epub|pdf|mobi|azw3?|fb2|cbz|cbr|djvu`

var (
	bookCategory = regexp.MustCompile(`^book( |$)`)
	ebookFormat  = regexp.MustCompile(`(?i)^(?:` + ebookFormats + `)$`)
	ebookSuffix  = regexp.MustCompile(`(?i)(?:\.(?:` + ebookFormats + `)|\[(?:` + ebookFormats + `)\]|\((?:` + ebookFormats + `)\))$`)
	labeledISBN  = regexp.MustCompile(`(?i)(?:\bISBN(?:[- ]?(?:10|13))?\s*:?\s*)?(` + titleISBN.String() + `)`)
)

func authorName(name string) string {
	if last, first, ok := strings.Cut(name, ","); ok && !strings.Contains(first, ",") {
		return matchText(first + " " + last)
	}
	return matchText(name)
}

func (s seriesMetadata) differentVolume(other seriesMetadata) bool {
	if len(s.Position) == 0 || len(other.Position) == 0 {
		return false
	}
	name := matchText(metadataString(s.Name))
	if name == "" || name != matchText(metadataString(other.Name)) {
		return false
	}
	var a, b json.Number
	if json.Unmarshal(s.Position, &a) != nil || json.Unmarshal(other.Position, &b) != nil {
		return false
	}
	left, errLeft := a.Float64()
	right, errRight := b.Float64()
	return errLeft == nil && errRight == nil && left != right
}

func (m releaseMatcher) approvalBasis(item verifiedRelease, isbn isbnEvidence) string {
	r := item.release
	if m.fullTitle == "" || isbn.conflict || (m.language != "" && !strings.EqualFold(m.language, strings.TrimSpace(r.Language))) {
		return ""
	}
	if title := matchText(item.bookTitle); title != "" && title != m.title && title != m.fullTitle {
		return ""
	}
	if m.series.differentVolume(item.series) {
		return ""
	}
	var content string
	if len(item.contentType) > 0 && json.Unmarshal(item.contentType, &content) != nil {
		return ""
	}
	content = strings.ToLower(strings.TrimSpace(content))
	if content != "" && content != "ebook" && !bookCategory.MatchString(content) {
		return ""
	}
	format := strings.TrimSpace(r.Format)
	title := strings.TrimSpace(r.Title)
	suffix := ebookSuffix.FindString(title)
	if format != "" && !ebookFormat.MatchString(format) {
		return ""
	}
	if format == "" && content != "ebook" && suffix == "" {
		return ""
	}
	if suffix != "" {
		title = strings.TrimSpace(strings.TrimSuffix(title, suffix))
	}
	if isbn.inTitle {
		title = labeledISBN.ReplaceAllStringFunc(title, func(value string) string {
			if m.isbns[metadata.MatcherISBN(labeledISBN.FindStringSubmatch(value)[1])] {
				return " "
			}
			return value
		})
	}
	byline := strings.TrimSpace(r.Author)
	if item.conflictingAuthors || (byline != "" && !m.bylines[authorName(byline)]) {
		return ""
	}
	fullTitle := matchText(title)
	withAuthor := m.matchesBylinedTitle(fullTitle)
	if !withAuthor && fullTitle != m.fullTitle {
		return ""
	}
	if isbn.structured {
		return "isbn"
	}
	if byline != "" || withAuthor {
		return "title_author"
	}
	return ""
}

func (m releaseMatcher) matchesBylinedTitle(listing string) bool {
	for author := range m.bylines {
		if listing == author+" "+m.fullTitle || listing == m.fullTitle+" "+author || listing == m.fullTitle+" by "+author {
			return true
		}
	}
	return false
}
