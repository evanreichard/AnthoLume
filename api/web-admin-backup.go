package api

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
)

const maxAdminBackupBytes = 1 << 30
const adminBackupName = "antholume.db"

func (api *API) adminBackupDir() string { return filepath.Join(api.cfg.ConfigPath, "web-backups") }

func (api *API) createAdminBackup(ctx context.Context) error {
	var pages, pageSize int64
	if err := api.db.DB.QueryRowContext(ctx, `SELECT page_count,page_size FROM pragma_page_count,pragma_page_size`).Scan(&pages, &pageSize); err != nil {
		return err
	}
	if pages <= 0 || pageSize <= 0 || pages > maxAdminBackupBytes/pageSize {
		return errors.New("database exceeds backup size budget")
	}
	dir := api.adminBackupDir()
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

func (api *API) walkBackupBooks(ctx context.Context, db *sql.DB, add func(string, *os.File) error) (AdminBackupPreview, error) {
	var out AdminBackupPreview
	root, err := api.queryStorageRoot(ctx, db, libraryRoot)
	if err != nil {
		return out, err
	}
	rows, err := db.QueryContext(ctx, `SELECT DISTINCT filepath FROM documents WHERE NOT deleted AND COALESCE(storage_root_id,'library')='library' AND filepath IS NOT NULL ORDER BY filepath`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return out, err
		}
		f, err := openStoredFile(root.Path, name)
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
	return out, rows.Err()
}

func (s *webAPI) PreviewAdminBackup(ctx context.Context, _ PreviewAdminBackupRequestObject) (PreviewAdminBackupResponseObject, error) {
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	ctx = requestContext(ctx)
	preview, err := s.api.walkBackupBooks(ctx, s.api.db.DB, nil)
	if err != nil {
		return nil, err
	}
	return PreviewAdminBackup200JSONResponse(preview), nil
}

func (s *webAPI) DownloadAdminBackup(ctx context.Context, r DownloadAdminBackupRequestObject) (DownloadAdminBackupResponseObject, error) {
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	name, attachment, maxSize := adminBackupName, "antholume-backup.db", int64(maxAdminBackupBytes)
	if r.Params.Full != nil && *r.Params.Full {
		name, attachment, maxSize = fullBackupName, "antholume-backup.zip", maxBackupArchiveBytes
	}
	f, err := os.Open(filepath.Join(s.api.adminBackupDir(), name))
	if errors.Is(err, os.ErrNotExist) {
		return nil, adminFailure(404, "backup_not_found")
	}
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maxSize {
		f.Close()
		return nil, errors.New("invalid database backup")
	}
	ginContext(ctx).Header("Content-Disposition", `attachment; filename="`+attachment+`"`)
	return DownloadAdminBackup200ApplicationoctetStreamResponse{Body: f, ContentLength: info.Size()}, nil
}
