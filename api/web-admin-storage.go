package api

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"

	"reichard.io/antholume/database"
	"reichard.io/antholume/pkg/storagepath"
)

const libraryRoot = "library"
const importsRoot = "imports"

var storageRootID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

func (api *API) effectiveRoot(root AdminStorageRoot) AdminStorageRoot {
	if root.Path == "" {
		switch root.Id {
		case libraryRoot:
			root.Path = filepath.Join(api.cfg.DataPath, "documents")
		case importsRoot:
			root.Path = filepath.Join(api.cfg.DataPath, "imports")
		}
		if root.Path != "" {
			root.Path, _ = filepath.Abs(root.Path)
		}
	}
	return root
}

func (api *API) storageRoot(ctx context.Context, id string) (AdminStorageRoot, error) {
	return api.queryStorageRoot(ctx, api.db.DB, id)
}
func (api *API) queryStorageRoot(ctx context.Context, q database.DBTX, id string) (AdminStorageRoot, error) {
	row, err := database.New(q).GetStorageRoot(ctx, id)
	if err != nil {
		return AdminStorageRoot{}, err
	}
	root := AdminStorageRoot{Id: row.ID, Label: row.Label, Managed: row.Managed, LegacyPath: row.LegacyPath}
	if row.Path != nil {
		root.Path = *row.Path
	}
	return api.effectiveRoot(root), nil
}

func bookRelativePath(name string) bool {
	return storagepath.Valid(name)
}

func openStoredFile(base, name string) (*os.File, error) {
	if base == "" || !bookRelativePath(name) {
		return nil, os.ErrNotExist
	}
	root, err := os.OpenRoot(base)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	f, err := root.OpenFile(filepath.FromSlash(name), os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		return nil, os.ErrNotExist
	}
	return f, nil
}

func (s *webAPI) ListAdminStorageRoots(ctx context.Context, _ ListAdminStorageRootsRequestObject) (ListAdminStorageRootsResponseObject, error) {
	rows, err := s.api.db.Queries.ListStorageRootsWithBookCounts(requestContext(ctx))
	if err != nil {
		return nil, err
	}
	out := make(ListAdminStorageRoots200JSONResponse, 0, len(rows))
	for _, row := range rows {
		r := AdminStorageRoot{Id: row.ID, Label: row.Label, Managed: row.Managed, LegacyPath: row.LegacyPath, BookCount: int(row.BookCount)}
		if row.Path != nil {
			r.Path = *row.Path
		}
		r = s.api.effectiveRoot(r)
		path := r.Path
		if path == "" && r.LegacyPath != nil {
			path = *r.LegacyPath
		}
		r.DirectoryAvailable = isDirectory(path)
		out = append(out, r)
	}
	return out, nil
}

func (s *webAPI) SaveAdminStorageRoot(ctx context.Context, r SaveAdminStorageRootRequestObject) (SaveAdminStorageRootResponseObject, error) {
	api := s.api
	if r.Body == nil {
		return nil, adminFailure(400, "invalid_request")
	}
	root := *r.Body
	root.Label = strings.TrimSpace(root.Label)
	if !storageRootID.MatchString(root.Id) || root.Label == "" {
		return nil, adminFailure(400, "invalid_request")
	}
	var path *string
	if root.Path != "" {
		resolved, err := storageDirectory(root.Path)
		if err != nil {
			return nil, err
		}
		path = &resolved
	} else if root.Id != libraryRoot && root.Id != importsRoot {
		return nil, adminFailure(400, "invalid_storage_directory")
	}
	if !api.libraryWrite.TryLock() {
		return nil, adminFailure(409, "server_busy")
	}
	defer api.libraryWrite.Unlock()
	err := s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		return api.db.Queries.WithTx(tx).UpsertStorageRoot(ctx, database.UpsertStorageRootParams{
			ID: root.Id, Label: root.Label, Path: path, Managed: root.Id == libraryRoot,
		})
	})
	if err != nil {
		return nil, err
	}
	return SaveAdminStorageRoot204Response{}, nil
}

func storageDirectory(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", adminFailure(400, "invalid_storage_directory")
	}
	path = filepath.Clean(path)
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return "", adminFailure(404, "storage_directory_not_found")
	}
	return path, nil
}

func (api *API) openImportSource(ctx context.Context, rootID string) (*os.Root, error) {
	storage, err := api.storageRoot(ctx, rootID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, adminFailure(404, "storage_root_not_found")
	}
	if err != nil {
		return nil, err
	}
	if storage.Managed {
		return nil, adminFailure(400, "invalid_import_source")
	}
	if storage.Path == "" {
		return nil, adminFailure(404, "import_folder_not_found")
	}
	root, err := os.OpenRoot(storage.Path)
	if err != nil {
		return nil, adminFailure(404, "import_folder_not_found")
	}
	return root, nil
}

func (s *webAPI) BrowseAdminStorageDirectories(ctx context.Context, r BrowseAdminStorageDirectoriesRequestObject) (BrowseAdminStorageDirectoriesResponseObject, error) {
	ctx = requestContext(ctx)
	path := string(filepath.Separator)
	if r.Params.Path != nil {
		path = *r.Params.Path
	}
	path, err := storageDirectory(path)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, adminFailure(403, "storage_directory_unreadable")
	}
	defer f.Close()
	result := BrowseAdminStorageDirectories200JSONResponse{Path: path, Parent: filepath.Dir(path), Entries: []string{}}
	for {
		entries, err := f.ReadDir(256)
		for _, entry := range entries {
			if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 && isDirectory(filepath.Join(path, entry.Name())) {
				result.Entries = append(result.Entries, entry.Name())
			}
		}
		if len(result.Entries) > 10000 {
			return nil, adminFailure(400, "import_folder_too_large")
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, adminFailure(403, "storage_directory_unreadable")
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
	}
	sort.Strings(result.Entries)
	return result, nil
}

func isDirectory(name string) bool {
	info, err := os.Stat(name)
	return err == nil && info.IsDir()
}
