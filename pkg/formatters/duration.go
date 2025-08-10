package formatters

import (
	"fmt"
	"strings"
	"time"
)

// FormatDuration takes a duration and returns a human-readable duration string.
// For example: 1928371 seconds -> "22d 7h 39m 31s"
func FormatDuration(d time.Duration) string {
	if d == 0 {
		return "N/A"
	}

	var parts []string

	days := int(d.Hours()) / 24
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60
	seconds := int(d.Seconds()) % 60

	if days > 0 {
		parts = append(parts, fmt.Sprintf("%dd", days))
	}
	if hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
	}
	if minutes > 0 {
		parts = append(parts, fmt.Sprintf("%dm", minutes))
	}
	if seconds > 0 {
		parts = append(parts, fmt.Sprintf("%ds", seconds))
	}

	return strings.Join(parts, " ")
}
