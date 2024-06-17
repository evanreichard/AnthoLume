package api

import (
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"reflect"
	"strings"

	"reichard.io/antholume/database"
	"reichard.io/antholume/graph"
	"reichard.io/antholume/metadata"
)

// getTimeZones returns a string slice of IANA timezones.
func getTimeZones() []string {
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
func niceSeconds(input int64) (result string) {
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
func niceNumbers(input int64) string {
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

// getSVGGraphData builds SVGGraphData from the provided stats, width and height.
// It is used exclusively in templates to generate the daily read stats graph.
func getSVGGraphData(inputData []database.GetDailyReadStatsRow, svgWidth int, svgHeight int) graph.SVGGraphData {
	var intData []int64
	for _, item := range inputData {
		intData = append(intData, item.MinutesRead)
	}

	return graph.GetSVGGraphData(intData, svgWidth, svgHeight)
}

// dict returns a map[string]any dict. Each pair of two is a key & value
// respectively. It's primarily utilized in templates.
func dict(values ...any) (map[string]any, error) {
	if len(values)%2 != 0 {
		return nil, errors.New("invalid dict call")
	}
	dict := make(map[string]any, len(values)/2)
	for i := 0; i < len(values); i += 2 {
		key, ok := values[i].(string)
		if !ok {
			return nil, errors.New("dict keys must be strings")
		}
		dict[key] = values[i+1]
	}
	return dict, nil
}

// fields returns a map[string]any of the provided struct. It's primarily
// utilized in templates.
func fields(value any) (map[string]any, error) {
	v := reflect.Indirect(reflect.ValueOf(value))
	if v.Kind() != reflect.Struct {
		return nil, fmt.Errorf("%T is not a struct", value)
	}
	m := make(map[string]any)
	t := v.Type()
	for i := 0; i < t.NumField(); i++ {
		sv := t.Field(i)
		m[sv.Name] = v.Field(i).Interface()
	}
	return m, nil
}

// slice returns a slice of the provided arguments. It's primarily utilized in
// templates.
func slice(elements ...any) []any {
	return elements
}

// deriveBaseFileName builds the base filename for a given MetadataInfo object.
func deriveBaseFileName(metadataInfo *metadata.MetadataInfo) string {
	// Derive New FileName
	var newFileName string
	if *metadataInfo.Author != "" {
		newFileName = newFileName + *metadataInfo.Author
	} else {
		newFileName = newFileName + "Unknown"
	}
	if *metadataInfo.Title != "" {
		newFileName = newFileName + " - " + *metadataInfo.Title
	} else {
		newFileName = newFileName + " - Unknown"
	}

	// Remove Slashes
	fileName := strings.ReplaceAll(newFileName, "/", "")
	return "." + filepath.Clean(fmt.Sprintf("/%s [%s]%s", fileName, *metadataInfo.PartialMD5, metadataInfo.Type))
}

// importStatusPriority returns the order priority for import status in the UI.
func importStatusPriority(status importStatus) int {
	switch status {
	case importFailed:
		return 1
	case importExists:
		return 2
	default:
		return 3
	}
}
