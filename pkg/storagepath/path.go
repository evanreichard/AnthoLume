// Package storagepath validates portable paths relative to a configured storage root.
package storagepath

import (
	"io/fs"
	"path/filepath"
	"strings"
)

func Valid(name string) bool {
	return name != "." && fs.ValidPath(name) && !strings.ContainsAny(name, "\\\x00") &&
		filepath.IsLocal(filepath.FromSlash(name)) && !hasDrivePrefix(name)
}

func hasDrivePrefix(name string) bool {
	return len(name) >= 2 && name[1] == ':' && (name[0] >= 'A' && name[0] <= 'Z' || name[0] >= 'a' && name[0] <= 'z')
}

// NormalizeLegacy accepts redundant "." components, but never cleans away traversal or an absolute path.
func NormalizeLegacy(name string) (string, bool) {
	if strings.HasSuffix(name, "/.") {
		return "", false
	}
	parts := strings.Split(name, "/")
	kept := parts[:0]
	for _, part := range parts {
		switch part {
		case "", "..":
			return "", false
		case ".":
			continue
		default:
			kept = append(kept, part)
		}
	}
	canonical := strings.Join(kept, "/")
	return canonical, Valid(canonical)
}
