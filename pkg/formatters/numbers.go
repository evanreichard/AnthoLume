package formatters

import (
	"fmt"
	"math"
)

// FormatNumber takes an int64 and returns a human-readable string.
// For example: 19823 -> "19.8k", 1500000 -> "1.5M"
func FormatNumber(input int64) string {
	if input == 0 {
		return "0"
	}

	// Handle Negative
	negative := input < 0
	if negative {
		input = -input
	}

	abbreviations := []string{"", "k", "M", "B", "T"}
	abbrevIndex := int(math.Log10(float64(input)) / 3)

	// Bounds Check
	if abbrevIndex >= len(abbreviations) {
		abbrevIndex = len(abbreviations) - 1
	}

	scaledNumber := float64(input) / math.Pow(10, float64(abbrevIndex*3))

	var result string
	if scaledNumber >= 100 {
		result = fmt.Sprintf("%.0f%s", scaledNumber, abbreviations[abbrevIndex])
	} else if scaledNumber >= 10 {
		result = fmt.Sprintf("%.1f%s", scaledNumber, abbreviations[abbrevIndex])
	} else {
		result = fmt.Sprintf("%.2f%s", scaledNumber, abbreviations[abbrevIndex])
	}

	if negative {
		result = "-" + result
	}

	return result
}
