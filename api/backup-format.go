package api

import (
	"errors"
	"strings"

	"reichard.io/antholume/pkg/storagepath"
)

const (
	maxBackupEntries      = 50001 // Database plus up to 50,000 files.
	maxBackupEntryPath    = 512
	maxBackupArchiveBytes = maxLibraryBackup + (32 << 20)
)

type backupArchiveBudget struct {
	entries int
	bytes   uint64
}

func (b *backupArchiveBudget) add(name string, size uint64) error {
	if b.entries >= maxBackupEntries || size > maxLibraryBackup-b.bytes || (name == adminBackupName && size > maxAdminBackupBytes) {
		return errors.New("backup archive exceeds limits")
	}
	b.entries++
	b.bytes += size
	return nil
}

func backupEntryName(name string) (string, error) {
	if len(name) > maxBackupEntryPath {
		return "", errors.New("backup entry path too long")
	}
	if name == adminBackupName {
		return name, nil
	}
	for _, prefix := range []string{"documents/" + libraryRoot + "/", "covers/"} {
		if rel, ok := strings.CutPrefix(name, prefix); ok {
			if canonical, valid := storagepath.NormalizeLegacy(rel); valid {
				return prefix + canonical, nil
			}
		}
	}
	return "", errors.New("invalid backup entry path")
}
