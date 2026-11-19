package api

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"

	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
)

const fullBackupName = "antholume.zip"
const maxLibraryBackup = 16 << 30

func (api *API) createFullBackup(ctx context.Context) error {
	dir := api.adminBackupDir()
	if err := ensurePrivateAdminDir(dir); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(dir, "archive-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	snapshot := filepath.Join(stage, adminBackupName)
	if err := api.writeVerifiedSnapshot(ctx, snapshot); err != nil {
		return err
	}
	filename := filepath.Join(stage, fullBackupName)
	target, err := os.OpenFile(filename, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer target.Close()
	archive := zip.NewWriter(target)
	var budget backupArchiveBudget
	seen := map[string]bool{}
	add := func(name string, file *os.File) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		canonical, err := backupEntryName(name)
		if err != nil || canonical != name || seen[name] {
			return errors.New("invalid backup entry name")
		}
		seen[name] = true
		info, err := file.Stat()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("backup entry is not a regular file")
		}
		if err := budget.add(name, uint64(info.Size())); err != nil {
			return err
		}
		header := &zip.FileHeader{Name: name, Method: zip.Store}
		header.SetModTime(info.ModTime())
		w, err := archive.CreateHeader(header)
		if err != nil {
			return err
		}
		n, err := io.Copy(w, io.LimitReader(contextReader{ctx, file}, info.Size()+1))
		if err != nil {
			return err
		}
		if n != info.Size() {
			return errors.New("file changed during backup")
		}
		return nil
	}
	db, err := os.Open(snapshot)
	if err != nil {
		return err
	}
	err = add(adminBackupName, db)
	db.Close()
	if err != nil {
		return err
	}
	catalog, err := sql.Open("sqlite", snapshotURI(snapshot))
	if err != nil {
		return err
	}
	defer catalog.Close()
	_, err = api.walkBackupBooks(ctx, catalog, func(name string, f *os.File) error { return add("documents/library/"+name, f) })
	if err != nil {
		return err
	}
	{
		folder := "covers"
		root, err := os.OpenRoot(filepath.Join(api.cfg.DataPath, folder))
		if err != nil {
			return err
		}
		err = fs.WalkDir(root.FS(), ".", func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			if entry.IsDir() {
				return nil
			}
			if !entry.Type().IsRegular() {
				return errors.New("managed backup directory contains a nonregular file")
			}
			f, err := root.Open(path)
			if err != nil {
				return err
			}
			defer f.Close()
			return add(folder+"/"+path, f)
		})
		root.Close()
		if err != nil {
			return err
		}
	}
	if err := archive.Close(); err != nil {
		return err
	}
	if err := target.Sync(); err != nil {
		return err
	}
	if err := target.Close(); err != nil {
		return err
	}
	info, err := os.Stat(filename)
	if err != nil {
		return err
	}
	if info.Size() > maxBackupArchiveBytes {
		return errors.New("backup archive exceeds upload limit")
	}
	verified, err := zip.OpenReader(filename)
	if err != nil {
		return err
	}
	defer verified.Close()
	for _, entry := range verified.File {
		r, err := entry.Open()
		if err != nil {
			return err
		}
		_, err = io.Copy(io.Discard, contextReader{ctx, r})
		r.Close()
		if err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.Rename(filename, filepath.Join(dir, fullBackupName)); err != nil {
		return err
	}
	return syncAdminDirectory(dir)
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}

func ensurePrivateAdminDir(dir string) error {
	if err := os.Mkdir(dir, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return err
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm() != 0700 {
		return errors.New("admin storage must be private")
	}
	return nil
}

func (api *API) importFolder(ctx context.Context, rootID string) (*os.Root, []string, error) {
	folder, err := api.openImportSource(ctx, rootID)
	if err != nil {
		return nil, nil, err
	}
	files := []string{}
	visited := 0
	err = fs.WalkDir(folder.FS(), ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		visited++
		if visited > 10000 {
			return adminFailure(400, "import_folder_too_large")
		}
		if !d.IsDir() && d.Type().IsRegular() && strings.EqualFold(filepath.Ext(name), ".epub") {
			files = append(files, name)
			if len(files) > 1000 {
				return adminFailure(400, "import_folder_too_large")
			}
		}
		return nil
	})
	if err != nil {
		folder.Close()
		return nil, nil, err
	}
	return folder, files, nil
}

func (s *webAPI) PreviewAdminImport(ctx context.Context, r PreviewAdminImportRequestObject) (PreviewAdminImportResponseObject, error) {
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	source := importsRoot
	if r.Params.RootId != nil {
		source = *r.Params.RootId
	}
	root, files, err := s.api.importFolder(requestContext(ctx), source)
	if err != nil {
		return nil, err
	}
	root.Close()
	return PreviewAdminImport200JSONResponse(files), nil
}

func (api *API) importBook(ctx context.Context, root *os.Root, destination AdminStorageRoot, name string, reference, relink bool) (AdminImportResultStatus, error) {
	source, err := root.OpenFile(filepath.FromSlash(name), os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return "failed", err
	}
	defer source.Close()
	info, err := source.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > metadata.MaxDocumentSize {
		return "failed", errors.New("invalid source file")
	}
	open := source
	target := name
	kept := false
	if !reference {
		temp, err := os.CreateTemp(destination.Path, "import-*.epub")
		if err != nil {
			return "failed", err
		}
		defer func() {
			temp.Close()
			if !kept {
				os.Remove(temp.Name())
			}
		}()
		n, err := io.Copy(temp, io.LimitReader(contextReader{ctx, source}, metadata.MaxDocumentSize+1))
		if err != nil || n != info.Size() {
			return "failed", errors.New("incomplete import")
		}
		if err := temp.Sync(); err != nil {
			return "failed", err
		}
		if err := syncAdminDirectory(destination.Path); err != nil {
			return "failed", err
		}
		open, target = temp, filepath.Base(temp.Name())
	}
	m, err := metadata.GetOpenedMetadata(open)
	if err != nil {
		return "failed", err
	}
	if after, err := source.Stat(); err != nil || after.Size() != info.Size() || after.ModTime() != info.ModTime() {
		return "failed", errors.New("source changed during import")
	}
	attached, err := api.attachCatalogFile(ctx, destination.Id, target, m)
	if err != nil {
		return "failed", err
	}
	if !attached {
		if !relink {
			return "skipped", nil
		}
		updated, err := api.relinkImportedBook(ctx, *m.PartialMD5, *m.MD5, destination.Id, target)
		if err != nil {
			return "failed", err
		}
		if !updated {
			return "skipped", nil
		}
		kept = !reference
		return "relinked", nil
	}
	kept = !reference
	return "imported", nil
}

func (api *API) relinkImportedBook(ctx context.Context, id, hash, root, target string) (bool, error) {
	d, err := api.db.Queries.GetDocument(ctx, id)
	if err != nil {
		return false, err
	}
	if d.Deleted || d.Md5 == nil || *d.Md5 != hash {
		return false, nil
	}
	current, err := api.openDocument(ctx, d)
	if err == nil {
		current.Close()
		return false, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	count, err := api.db.Queries.RelinkImportedDocument(ctx, database.RelinkImportedDocumentParams{
		StorageRootID: &root, Filepath: &target, ID: id, Md5: &hash,
		OldFilepath: d.Filepath, OldStorageRootID: d.StorageRootID,
	})
	return count == 1, err
}

func (api *API) importDestination(ctx context.Context, source string, reference bool) (AdminStorageRoot, error) {
	dest := libraryRoot
	if reference {
		dest = source
	}
	root, err := api.storageRoot(ctx, dest)
	if errors.Is(err, sql.ErrNoRows) {
		return root, adminFailure(404, "storage_root_not_found")
	}
	if err != nil {
		return root, err
	}
	if root.Managed == reference || root.Path == "" || !isDirectory(root.Path) {
		return root, adminFailure(400, "invalid_import_destination")
	}
	return root, nil
}

var adminJobID = regexp.MustCompile(`^[a-f0-9]{64}$`)

func (api *API) runLibraryImport(ctx context.Context, id, sourceID string, reference, relink bool) error {
	results, err := api.importBooks(ctx, sourceID, reference, relink, nil)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(results)
	if err != nil {
		return err
	}
	return api.db.Queries.SetLibraryImportResult(ctx, database.SetLibraryImportResultParams{Result: encoded, ID: id})
}

func (api *API) importBooks(ctx context.Context, sourceID string, reference, relink bool, accept func(*os.Root, string) bool) ([]AdminImportResult, error) {
	root, files, err := api.importFolder(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	target, err := api.importDestination(ctx, sourceID, reference)
	if err != nil {
		return nil, err
	}
	results := make([]AdminImportResult, 0, len(files))
	for _, file := range files {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if accept != nil && !accept(root, file) {
			continue
		}
		status, _ := api.importBook(ctx, root, target, file, reference, relink)
		results = append(results, AdminImportResult{File: file, Status: status})
	}
	return results, nil
}

func (s *webAPI) ListAdminImportResults(ctx context.Context, r ListAdminImportResultsRequestObject) (ListAdminImportResultsResponseObject, error) {
	if !webUser(ctx).IsAdmin {
		return nil, adminFailure(403, "forbidden")
	}
	if !adminJobID.MatchString(r.Params.Job) {
		return nil, adminFailure(400, "invalid_request")
	}
	result, err := s.api.db.Queries.GetSucceededLibraryImportResult(requestContext(ctx), r.Params.Job)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, adminFailure(404, "job_not_found")
	} else if err != nil {
		return nil, err
	}
	rows := ListAdminImportResults200JSONResponse{}
	err = json.Unmarshal(result, &rows)
	return rows, err
}
