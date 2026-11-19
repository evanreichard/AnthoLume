package api

import (
	"fmt"
	"path/filepath"
	"strings"

	"reichard.io/antholume/metadata"
)

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
