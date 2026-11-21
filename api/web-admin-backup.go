package api

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"time"

	log "github.com/sirupsen/logrus"

	"reichard.io/antholume/database"
	"reichard.io/antholume/pkg/storagepath"
)

const maxAdminBackupBytes = 1 << 30
const adminBackupName = "antholume.db"

func (api *API) createAdminBackup(ctx context.Context, dir string) error {
	var pages, pageSize int64
	if err := api.db.DB.QueryRowContext(ctx, `SELECT page_count,page_size FROM pragma_page_count,pragma_page_size`).Scan(&pages, &pageSize); err != nil {
		return err
	}
	if pages <= 0 || pageSize <= 0 || pages > maxAdminBackupBytes/pageSize {
		return errors.New("database exceeds backup size budget")
	}
	if err := os.Mkdir(dir, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm() != 0700 {
		return errors.New("backup directory must be private")
	}
	if err := syncAdminDirectory(filepath.Dir(dir)); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "snapshot-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := api.writeVerifiedSnapshot(ctx, name); err != nil {
		return err
	}
	if err := validateBackupCatalogFile(ctx, name); err != nil {
		return err
	}
	info, err = os.Stat(name)
	if err != nil {
		return err
	}
	if info.Size() > maxAdminBackupBytes {
		return errors.New("snapshot exceeds backup size budget")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.Rename(name, filepath.Join(dir, adminBackupName)); err != nil {
		return err
	}
	return syncAdminDirectory(dir)
}

type backupBookList struct {
	root  string
	paths []*string
}

func (api *API) listBackupBooks(ctx context.Context, db database.DBTX) (backupBookList, error) {
	root, err := api.queryStorageRoot(ctx, db, libraryRoot)
	if err != nil {
		return backupBookList{}, err
	}
	paths, err := database.New(db).ListBackupLibraryFilepaths(ctx)
	return backupBookList{root.Path, paths}, err
}

func (books backupBookList) walk(ctx context.Context, add func(string, *os.File) error) (AdminBackupPreview, error) {
	var out AdminBackupPreview
	seen := make(map[string]bool, len(books.paths))
	for _, path := range books.paths {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		name, ok := storagepath.NormalizeLegacy(*path)
		if !ok || seen[name] {
			continue
		}
		seen[name] = true
		f, err := openStoredFile(books.root, name)
		if err != nil {
			out.Missing++
			continue
		}
		info, err := f.Stat()
		if err == nil && add != nil {
			err = add(name, f)
		}
		f.Close()
		if err != nil {
			return out, err
		}
		out.Files++
		out.Bytes += info.Size()
	}
	return out, ctx.Err()
}

func (api *API) previewBookList(ctx context.Context) (backupBookList, error) {
	tx, err := api.db.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return backupBookList{}, err
	}
	defer tx.Rollback()
	if _, _, err := validateBackupCatalog(ctx, tx); err != nil {
		return backupBookList{}, err
	}
	return api.listBackupBooks(ctx, tx)
}

func (s *webAPI) PreviewAdminBackup(ctx context.Context, _ PreviewAdminBackupRequestObject) (PreviewAdminBackupResponseObject, error) {
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	ctx = requestContext(ctx)
	books, err := s.api.previewBookList(ctx)
	if err != nil {
		return nil, err
	}
	preview, err := books.walk(ctx, nil)
	if err != nil {
		return nil, err
	}
	return PreviewAdminBackup200JSONResponse(preview), nil
}

func (s *webAPI) DownloadAdminBackup(ctx context.Context, r DownloadAdminBackupRequestObject) (DownloadAdminBackupResponseObject, error) {
	user := webUser(ctx)
	if !user.IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	// Native Downloads - Browser links cannot send the expected account headers.
	if r.Params.Account != nil || r.Params.Generation != nil {
		if r.Params.Account == nil || *r.Params.Account != user.AccountID {
			return nil, adminFailure(401, "account_changed")
		}
		if r.Params.Generation == nil || *r.Params.Generation != user.Generation {
			return nil, adminFailure(409, "stale_reading_generation")
		}
	}
	if ginContext(ctx).GetHeader("Sec-Fetch-Site") == "cross-site" {
		return nil, adminFailure(403, "forbidden")
	}
	if !s.api.backupExport.TryLock() {
		return nil, adminFailure(409, "server_busy")
	}
	handedOff := false
	defer func() {
		if !handedOff {
			s.api.backupExport.Unlock()
		}
	}()
	dir, err := os.MkdirTemp(s.api.cfg.ConfigPath, ".backup-export-")
	if err != nil {
		return nil, err
	}
	defer func() {
		if !handedOff {
			removeBackupExport(dir)
		}
	}()
	req, cancel := context.WithTimeout(requestContext(ctx), 5*time.Minute)
	defer cancel()
	full := r.Params.Full != nil && *r.Params.Full
	name, attachment := adminBackupName, "antholume-backup.db"
	if full {
		name, attachment = fullBackupName, "antholume-backup.zip"
		if !s.api.libraryWrite.TryLock() {
			return nil, adminFailure(409, "server_busy")
		}
		func() {
			defer s.api.libraryWrite.Unlock()
			err = s.api.createFullBackup(req, dir)
		}()
	} else {
		err = s.api.createAdminBackup(req, dir)
	}
	if err != nil {
		return nil, err
	}
	f, err := os.Open(filepath.Join(dir, name))
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	body := &backupExportFile{File: f, cleanup: func() {
		removeBackupExport(dir)
		s.api.backupExport.Unlock()
	}}
	ginContext(ctx).Header("Content-Disposition", `attachment; filename="`+attachment+`"`)
	handedOff = true
	return DownloadAdminBackup200ApplicationoctetStreamResponse{Body: body, ContentLength: info.Size()}, nil
}

type backupExportFile struct {
	*os.File
	cleanup func()
}

func (f *backupExportFile) Close() error {
	defer f.cleanup()
	return f.File.Close()
}

func removeBackupExport(dir string) {
	if err := os.RemoveAll(dir); err != nil {
		log.WithError(err).Warn("Could not remove temporary backup export")
	}
}
