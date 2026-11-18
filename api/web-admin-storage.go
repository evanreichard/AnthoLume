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

func scanStorageRoot(row interface{ Scan(...any) error }) (AdminStorageRoot, error) {
	var root AdminStorageRoot
	err := row.Scan(&root.Id, &root.Label, &root.Path, &root.Managed, &root.LegacyPath)
	return root, err
}

const storageRootFields = `id,label,COALESCE(path,''),managed,legacy_path`

type storageQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func (api *API) storageRoot(ctx context.Context, id string) (AdminStorageRoot, error) {
	return api.queryStorageRoot(ctx, api.db.DB, id)
}
func (api *API) queryStorageRoot(ctx context.Context, q storageQuerier, id string) (AdminStorageRoot, error) {
	root, err := scanStorageRoot(q.QueryRowContext(ctx, `SELECT `+storageRootFields+` FROM storage_roots WHERE id=?`, id))
	return api.effectiveRoot(root), err
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
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	rows, err := s.api.db.DB.QueryContext(requestContext(ctx), `SELECT `+storageRootFields+`, COALESCE(book_counts.total,0)
 FROM storage_roots
 LEFT JOIN (
   SELECT COALESCE(storage_root_id,'library') AS root_id, COUNT(*) AS total
   FROM documents WHERE NOT deleted AND filepath IS NOT NULL GROUP BY 1
 ) AS book_counts ON book_counts.root_id=storage_roots.id
 ORDER BY id<>'library',label,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := ListAdminStorageRoots200JSONResponse{}
	for rows.Next() {
		var r AdminStorageRoot
		if err := rows.Scan(&r.Id, &r.Label, &r.Path, &r.Managed, &r.LegacyPath, &r.BookCount); err != nil {
			return nil, err
		}
		r = s.api.effectiveRoot(r)
		path := r.Path
		if path == "" && r.LegacyPath != nil {
			path = *r.LegacyPath
		}
		r.DirectoryAvailable = isDirectory(path)
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *webAPI) SaveAdminStorageRoot(ctx context.Context, r SaveAdminStorageRootRequestObject) (SaveAdminStorageRootResponseObject, error) {
	api := s.api
	if !webUser(ctx).IsAdmin || api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
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
	if !api.adminFiles.TryLock() {
		return nil, adminFailure(409, "server_busy")
	}
	defer api.adminFiles.Unlock()
	principal := webUser(ctx)
	ctx = requestContext(ctx)
	var admin bool
	if err := api.db.DB.QueryRowContext(ctx, `SELECT admin FROM users WHERE id=? AND auth_hash=?`, principal.UserName, principal.AuthHash).Scan(&admin); err != nil || !admin {
		return nil, adminFailure(403, "forbidden")
	}
	_, err := api.db.DB.ExecContext(ctx, `INSERT INTO storage_roots(id,label,path,managed) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,path=excluded.path,legacy_path=NULL`, root.Id, root.Label, path, root.Id == libraryRoot)
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
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
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
