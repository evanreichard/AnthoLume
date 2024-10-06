package common

import (
	"fmt"
	"math"
	"strings"
)

type Route string

var (
	RouteHome        Route = "HOME"
	RouteDocuments   Route = "DOCUMENTS"
	RouteProgress    Route = "PROGRESS"
	RouteActivity    Route = "ACTIVITY"
	RouteSearch      Route = "SEARCH"
	RouteAdmin       Route = "ADMIN"
	RouteAdminImport Route = "ADMIN_IMPORT"
	RouteAdminUsers  Route = "ADMIN_USERS"
	RouteAdminLogs   Route = "ADMIN_LOGS"
)

func (r Route) IsAdmin() bool {
	return strings.HasPrefix("ADMIN", string(r))
}

func (r Route) Name() string {
	var pathSplit []string
	for _, rawPath := range strings.Split(string(r), "_") {
		pathLoc := strings.ToUpper(rawPath[:1]) + strings.ToLower(rawPath[1:])
		pathSplit = append(pathSplit, pathLoc)

	}
	return strings.Join(pathSplit, " - ")
}

type Settings struct {
	Route         Route
	User          string
	Version       string
	IsAdmin       bool
	SearchEnabled bool
}

type UserMetadata struct {
	DocumentCount int
	ActivityCount int
	ProgressCount int
	DeviceCount   int
}

type UserStatistics struct {
	WPM      map[string][]UserStatisticEntry
	Duration map[string][]UserStatisticEntry
	Words    map[string][]UserStatisticEntry
}

type UserStatisticEntry struct {
	UserID string
	Value  string
}

// getTimeZones returns a string slice of IANA timezones.
func GetTimeZones() []string {
	return []string{
		"Africa/Cairo",
		"Africa/Johannesburg",
		"Africa/Lagos",
		"Africa/Nairobi",
		"America/Adak",
		"America/Anchorage",
		"America/Buenos_Aires",
		"America/Chicago",
		"America/Denver",
		"America/Los_Angeles",
		"America/Mexico_City",
		"America/New_York",
		"America/Nuuk",
		"America/Phoenix",
		"America/Puerto_Rico",
		"America/Sao_Paulo",
		"America/St_Johns",
		"America/Toronto",
		"Asia/Dubai",
		"Asia/Hong_Kong",
		"Asia/Kolkata",
		"Asia/Seoul",
		"Asia/Shanghai",
		"Asia/Singapore",
		"Asia/Tokyo",
		"Atlantic/Azores",
		"Australia/Melbourne",
		"Australia/Sydney",
		"Europe/Berlin",
		"Europe/London",
		"Europe/Moscow",
		"Europe/Paris",
		"Pacific/Auckland",
		"Pacific/Honolulu",
	}
}

// niceSeconds takes in an int (in seconds) and returns a string readable
// representation. For example 1928371 -> "22d 7h 39m 31s".
func NiceSeconds(input int64) (result string) {
	if input == 0 {
		return "N/A"
	}

	days := math.Floor(float64(input) / 60 / 60 / 24)
	seconds := input % (60 * 60 * 24)
	hours := math.Floor(float64(seconds) / 60 / 60)
	seconds = input % (60 * 60)
	minutes := math.Floor(float64(seconds) / 60)
	seconds = input % 60

	if days > 0 {
		result += fmt.Sprintf("%dd ", int(days))
	}
	if hours > 0 {
		result += fmt.Sprintf("%dh ", int(hours))
	}
	if minutes > 0 {
		result += fmt.Sprintf("%dm ", int(minutes))
	}
	if seconds > 0 {
		result += fmt.Sprintf("%ds", int(seconds))
	}

	return
}

// niceNumbers takes in an int and returns a string representation. For example
// 19823 -> "19.8k".
func NiceNumbers(input int64) string {
	if input == 0 {
		return "0"
	}

	abbreviations := []string{"", "k", "M", "B", "T"}
	abbrevIndex := int(math.Log10(float64(input)) / 3)
	scaledNumber := float64(input) / math.Pow(10, float64(abbrevIndex*3))

	if scaledNumber >= 100 {
		return fmt.Sprintf("%.0f%s", scaledNumber, abbreviations[abbrevIndex])
	} else if scaledNumber >= 10 {
		return fmt.Sprintf("%.1f%s", scaledNumber, abbreviations[abbrevIndex])
	} else {
		return fmt.Sprintf("%.2f%s", scaledNumber, abbreviations[abbrevIndex])
	}
}
