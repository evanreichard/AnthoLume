package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"
	"strings"

	"reichard.io/antholume/database"
	"reichard.io/antholume/pkg/storagepath"
)

const packedPath = "_backup"

var restoreDirectory = regexp.MustCompile(`^restore-[0-9a-f]{64}/`)

type backupPaths struct {
	prefix   string
	reserved map[string]bool
	mapped   map[string]string
	packed   map[string]bool
}

func newBackupPaths(prefix string) *backupPaths {
	return &backupPaths{prefix: prefix, reserved: map[string]bool{}, mapped: map[string]string{}, packed: map[string]bool{}}
}

func (p *backupPaths) add(ctx context.Context, name string, file *os.File, write func(string, *os.File) error) error {
	if !bookRelativePath(name) {
		return errors.New("invalid backup entry name")
	}
	entry := p.prefix + name
	packed := len(entry) > maxBackupEntryPath || restoreDirectory.MatchString(name) || name == packedPath || strings.HasPrefix(name, packedPath+"/")
	if !packed {
		return write(entry, file)
	}
	base := path.Base(name)
	if len(base) > 160 {
		ext := path.Ext(base)
		if len(ext) > 16 {
			ext = ""
		}
		base = "file" + ext
	}
	// Stable Archive Names - Hash the bytes instead of guessing which directories were created by restore.
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if info.Size() > maxLibraryBackup {
		return fmt.Errorf("backup file exceeds archive limits")
	}
	digest := sha256.New()
	n, err := io.Copy(digest, io.LimitReader(contextReader{ctx, file}, info.Size()+1))
	if err != nil {
		return err
	}
	if n != info.Size() {
		return fmt.Errorf("file changed during backup")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	stem := fmt.Sprintf("%s/%x", packedPath, digest.Sum(nil))
	nameInZip := stem + "/" + base
	for n := 1; p.reserved[nameInZip] && nameInZip != name && !p.packed[nameInZip]; n++ {
		nameInZip = fmt.Sprintf("%s-%d/%s", stem, n, base)
	}
	if !p.packed[nameInZip] {
		if err := write(p.prefix+nameInZip, file); err != nil {
			return err
		}
		p.packed[nameInZip] = true
	}
	if nameInZip != name {
		p.mapped[name] = nameInZip
	}
	return nil
}

func isBackupLibraryPath(root *string) bool { return root == nil || *root == libraryRoot }

func rewriteBackupPaths(ctx context.Context, db *sql.DB, docs []database.ListDocumentsForRestoreRow, books, covers *backupPaths) error {
	if len(books.mapped)+len(covers.mapped) == 0 {
		return nil
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	q := database.New(tx)
	for _, doc := range docs {
		file, cover := doc.Filepath, doc.Coverfile
		if file != nil && isBackupLibraryPath(doc.StorageRootID) {
			canonical, _ := storagepath.NormalizeLegacy(*file)
			if name, ok := books.mapped[canonical]; ok {
				file = &name
			}
		}
		if cover != nil {
			canonical, _ := storagepath.NormalizeLegacy(*cover)
			if name, ok := covers.mapped[canonical]; ok {
				cover = &name
			}
		}
		if file != doc.Filepath || cover != doc.Coverfile {
			if err := q.SetBackupDocumentPaths(ctx, database.SetBackupDocumentPathsParams{ID: doc.ID, Filepath: file, Coverfile: cover}); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}
