package metadata

import (
	"errors"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

const MatcherBatchSize = 10
const MatcherCandidateLimit = 8

var ErrInvalidMatcherBatch = errors.New("invalid catalog matcher batch")

type MatcherInput struct {
	ID, Title, Author, ISBN string
}

func ValidateMatcherBatch(books []MatcherInput) error {
	if len(books) == 0 || len(books) > MatcherBatchSize {
		return ErrInvalidMatcherBatch
	}
	seen := make(map[string]bool, len(books))
	for _, book := range books {
		if strings.TrimSpace(book.ID) == "" || seen[book.ID] {
			return ErrInvalidMatcherBatch
		}
		seen[book.ID] = true
	}
	return nil
}

func MatcherISBN(value string) string {
	isbn := strings.Map(func(r rune) rune {
		if r == '-' || unicode.IsSpace(r) {
			return -1
		}
		return unicode.ToUpper(r)
	}, value)
	if lookupISBN.MatchString(isbn) {
		return isbn
	}
	return ""
}

// ISBN Equivalence - Only a checksum-valid ISBN may expand to another identifier.
func MatcherISBNs(value string) []string {
	isbn := MatcherISBN(value)
	if isbn == "" {
		return nil
	}
	if len(isbn) == 10 && isbn10Check(isbn[:9]) == isbn[9:] {
		prefix := "978" + isbn[:9]
		return []string{isbn, prefix + isbn13Check(prefix)}
	}
	if len(isbn) == 13 && strings.HasPrefix(isbn, "978") && isbn13Check(isbn[:12]) == isbn[12:] {
		digits := isbn[3:12]
		return []string{isbn, digits + isbn10Check(digits)}
	}
	return []string{isbn}
}

func isbn10Check(digits string) string {
	sum := 0
	for i := range len(digits) {
		sum += (10 - i) * int(digits[i]-'0')
	}
	if check := (11 - sum%11) % 11; check != 10 {
		return strconv.Itoa(check)
	}
	return "X"
}

func isbn13Check(digits string) string {
	sum := 0
	for i := range len(digits) {
		sum += (1 + 2*(i%2)) * int(digits[i]-'0')
	}
	return strconv.Itoa((10 - sum%10) % 10)
}

func (b MatcherInput) SearchText() string {
	return lookupText(strings.Join(strings.Fields(b.Title+" "+b.Author), " "), 512)
}

func RankMatcherResults(book MatcherInput, matches []LookupMatch) []LookupMatch {
	normalize := func(text string) string {
		return strings.ToLower(strings.Join(strings.FieldsFunc(text, func(r rune) bool {
			return !unicode.IsLetter(r) && !unicode.IsNumber(r) && !unicode.IsMark(r)
		}), " "))
	}
	title, author := normalize(book.Title), normalize(book.Author)
	score := func(m LookupMatch) int {
		s := 0
		if author != "" && author == normalize(m.Author) {
			s++
		}
		if title != "" && title == normalize(m.Title) {
			s += 2
		}
		return s
	}
	sort.SliceStable(matches, func(i, j int) bool { return score(matches[i]) > score(matches[j]) })
	seen := make(map[string]bool, len(matches))
	results := make([]LookupMatch, 0, min(MatcherCandidateLimit, len(matches)))
	for _, match := range matches {
		if match.ID == "" || match.Title == "" || seen[match.ID] {
			continue
		}
		seen[match.ID] = true
		results = append(results, match)
		if len(results) == MatcherCandidateLimit {
			break
		}
	}
	return results
}
