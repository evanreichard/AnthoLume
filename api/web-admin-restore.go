package api

import (
	"archive/zip"
	"context"
	"database/sql"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"modernc.org/sqlite"
	"reichard.io/antholume/database"
	dbmigrations "reichard.io/antholume/database/migrations"
	"reichard.io/antholume/pkg/storagepath"
	"reichard.io/antholume/utils"
)

func (api *API) restoreBoundary(c *gin.Context) {
	if c.Request.Method == http.MethodPatch && c.Request.URL.Path == "/api/v1/admin/restore" {
		c.Next()
		return
	}
	api.restoreGate.RLock()
	defer api.restoreGate.RUnlock()
	c.Next()
}

func snapshotURI(name string) string {
	return (&url.URL{Scheme: "file", Path: name, RawQuery: "mode=ro&_pragma=trusted_schema(OFF)"}).String()
}

var (
	backupSQLToken     = regexp.MustCompile(`'(?:''|[^'])*'|[a-zA-Z_][a-zA-Z_0-9]*|[0-9]+|[^\s]`)
	backupMovedColumns = map[string][]*regexp.Regexp{
		"documents": {regexp.MustCompile(`,\s*basepath TEXT\b`), regexp.MustCompile(`,\s*storage_root_id TEXT REFERENCES storage_roots\s*\(id\)`)},
		"users":     {regexp.MustCompile(`,\s*auth_hash TEXT NOT NULL\b`), regexp.MustCompile(`,\s*timezone TEXT NOT NULL DEFAULT 'Europe/London'`)},
	}
)

// Historical table layouts append these columns rather than placing them in their current positions.
// Move only the known clauses; keep other columns, constraints, triggers, and indexes in the comparison.
func backupTableSchema(name, ddl string) string {
	columns, moved := backupMovedColumns[name]
	if !moved && name != "storage_roots" {
		return ddl
	}
	var suffix string
	for _, column := range columns {
		match := column.FindStringIndex(ddl)
		if match == nil {
			return ddl
		}
		suffix += ddl[match[0]:match[1]]
		ddl = ddl[:match[0]] + ddl[match[1]:]
	}
	return strings.Join(backupSQLToken.FindAllString(ddl+suffix, -1), " ")
}

func snapshotSchema(ctx context.Context, db *sql.DB) ([][4]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT type,name,tbl_name,coalesce(sql,'') FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var schema [][4]string
	for rows.Next() {
		var r [4]string
		if err := rows.Scan(&r[0], &r[1], &r[2], &r[3]); err != nil {
			return nil, err
		}
		if r[0] == "table" {
			r[3] = backupTableSchema(r[1], r[3])
		}
		schema = append(schema, r)
		if len(schema) > 10000 {
			return nil, errors.New("schema too large")
		}
	}
	return schema, rows.Err()
}

func (api *API) validateRestoreDB(ctx context.Context, name string) error {
	info, err := os.Stat(name)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > maxAdminBackupBytes {
		return errors.New("database size limit")
	}
	db, err := sql.Open("sqlite", snapshotURI(name))
	if err != nil {
		return err
	}
	defer db.Close()
	expected, err := snapshotSchema(ctx, api.db.DB)
	if err != nil {
		return err
	}
	actual, err := snapshotSchema(ctx, db)
	if !slices.ContainsFunc(actual, func(entry [4]string) bool { return entry[0] == "table" && entry[1] == "auto_import_rules" }) {
		expected = slices.DeleteFunc(expected, func(entry [4]string) bool { return entry[0] == "table" && entry[1] == "auto_import_rules" })
	}
	if err != nil || !reflect.DeepEqual(expected, actual) {
		return errors.New("restore requires a database with this server's schema")
	}
	const latestApplied = `SELECT COALESCE(MAX(version_id), 0) FROM goose_db_version WHERE is_applied = 1`
	var liveVersion, backupVersion int64
	if err := api.db.DB.QueryRowContext(ctx, latestApplied).Scan(&liveVersion); err != nil {
		return err
	}
	if err := db.QueryRowContext(ctx, latestApplied).Scan(&backupVersion); err != nil || backupVersion > liveVersion {
		return errors.New("unsupported snapshot version")
	}
	var integrity string
	if err := db.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&integrity); err != nil || integrity != "ok" {
		return errors.New("snapshot integrity check failed")
	}
	admins, err := database.New(db).CountSnapshotAdmins(ctx)
	if err != nil || admins == 0 {
		return errors.New("snapshot has no administrator")
	}
	return nil
}

func extractRestore(ctx context.Context, input, stage string, legacyArchive *bool) (int, error) {
	f, err := os.Open(input)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	signature := make([]byte, 16)
	if _, err := io.ReadFull(f, signature); err != nil {
		return 0, err
	}
	if string(signature) == "SQLite format 3\x00" {
		return 0, os.Rename(input, filepath.Join(stage, adminBackupName))
	}
	if string(signature[:4]) != "PK\x03\x04" {
		return 0, errors.New("unsupported restore archive")
	}
	info, err := f.Stat()
	if err != nil {
		return 0, err
	}
	archive, err := zip.NewReader(f, info.Size())
	if err != nil {
		return 0, err
	}
	if len(archive.File) > maxBackupEntries {
		return 0, errors.New("archive has too many entries")
	}
	seen := map[string]bool{}
	var budget backupArchiveBudget
	count := 0
	for _, file := range archive.File {
		name, err := backupEntryName(file.Name)
		if flat, ok := strings.CutPrefix(file.Name, "documents/"); err != nil && legacyArchive != nil && ok && !strings.Contains(flat, "/") {
			name, err = backupEntryName("documents/library/" + flat)
			*legacyArchive = true
		}
		if err != nil || !file.Mode().IsRegular() || seen[name] {
			return 0, errors.New("invalid backup entry")
		}
		seen[name] = true
		if err := budget.add(name, file.UncompressedSize64); err != nil {
			return 0, err
		}
		dest := filepath.Join(stage, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
			return 0, err
		}
		r, err := file.Open()
		if err != nil {
			return 0, err
		}
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			r.Close()
			return 0, err
		}
		n, err := io.Copy(out, io.LimitReader(contextReader{ctx, r}, int64(file.UncompressedSize64)+1))
		r.Close()
		closeErr := out.Close()
		if err != nil || closeErr != nil || uint64(n) != file.UncompressedSize64 {
			return 0, errors.New("archive entry could not be verified")
		}
		if name != adminBackupName {
			count++
		}
	}
	if !seen[adminBackupName] {
		return 0, errors.New("archive has no database")
	}
	return count, nil
}

func (api *API) stageRestore(ctx context.Context, input io.Reader, stage string) (int, error) {
	file, err := os.CreateTemp(stage, "upload-")
	if err != nil {
		return 0, err
	}
	defer os.Remove(file.Name())
	bytes, err := io.Copy(file, io.LimitReader(contextReader{ctx, input}, maxBackupArchiveBytes+1))
	closeErr := file.Close()
	if requestReadTimedOut(err) {
		return 0, adminFailure(http.StatusRequestTimeout, "request_timeout")
	}
	if err != nil || closeErr != nil {
		return 0, errors.New("restore upload failed")
	}
	if bytes > maxBackupArchiveBytes {
		return 0, adminFailure(413, "restore_too_large")
	}
	var legacyArchive bool
	files, err := extractRestore(ctx, file.Name(), stage, &legacyArchive)
	if err != nil {
		return 0, adminFailure(400, "invalid_restore_archive")
	}
	snapshot := filepath.Join(stage, adminBackupName)
	if err = api.upgradeRestoreSnapshot(ctx, snapshot, legacyArchive); err != nil {
		return 0, adminFailure(400, "incompatible_restore_database")
	}
	if err = api.normalizeRestorePageSize(ctx, snapshot); err != nil {
		return 0, adminFailure(400, "incompatible_restore_database")
	}
	if err = validateBackupCatalogFile(ctx, snapshot); err != nil {
		var issue *webFailure
		if errors.As(err, &issue) {
			return 0, issue
		}
		return 0, adminFailure(400, "invalid_restore_data")
	}
	return files, nil
}

func (api *API) adminBackupDir() string { return filepath.Join(api.cfg.ConfigPath, "web-backups") }

func (s *webAPI) StageAdminRestore(ctx context.Context, r StageAdminRestoreRequestObject) (StageAdminRestoreResponseObject, error) {
	principal := webUser(ctx)
	api := s.api
	if !principal.IsAdmin || api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	if !api.restoreStage.TryLock() {
		return nil, adminFailure(409, "restore_busy")
	}
	defer api.restoreStage.Unlock()
	if err := ensurePrivateAdminDir(api.adminBackupDir()); err != nil {
		return nil, err
	}
	ctx = requestContext(ctx)
	stage, err := os.MkdirTemp(api.adminBackupDir(), "restore-upload-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(stage)
	files, err := api.stageRestore(ctx, r.Body, stage)
	if err != nil {
		return nil, err
	}
	library, err := api.restoreLibraryPath(ctx, stage)
	if err != nil {
		return nil, err
	}
	var libraryPath *string
	if library != "" {
		libraryPath = &library
	}
	if err := os.WriteFile(filepath.Join(stage, "library-path"), []byte(library), 0600); err != nil {
		return nil, err
	}
	token, err := randomCSRF()
	if err != nil {
		return nil, err
	}
	if err = os.WriteFile(filepath.Join(stage, "owner"), []byte(principal.UserName+"\x00"+principal.AuthHash), 0600); err != nil {
		return nil, err
	}
	if err = os.RemoveAll(filepath.Join(api.adminBackupDir(), "restore-ready")); err != nil {
		return nil, err
	}
	if err = os.WriteFile(filepath.Join(stage, "token"), []byte(token), 0600); err != nil {
		return nil, err
	}
	if err = os.Rename(stage, filepath.Join(api.adminBackupDir(), "restore-ready")); err != nil {
		return nil, err
	}
	return StageAdminRestore200JSONResponse{Token: token, Files: files, LibraryPath: libraryPath}, nil
}

func (api *API) restoreLibraryPath(ctx context.Context, stage string) (string, error) {
	if !isDirectory(filepath.Join(stage, "documents", libraryRoot)) {
		return "", nil
	}
	library, err := api.storageRoot(ctx, libraryRoot)
	if err != nil || !isDirectory(library.Path) {
		return "", adminFailure(409, "restore_library_unavailable")
	}
	return library.Path, nil
}

func (api *API) prepareRestoreCatalog(ctx context.Context, db *sql.DB) error {
	roots, documents, err := validateBackupCatalog(ctx, db)
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	staged := database.New(tx)
	// Keep only mappings the local administrator configured; a snapshot cannot grant filesystem access.
	if err := staged.ClearSnapshotStorageRootPaths(ctx); err != nil {
		return err
	}
	for _, root := range roots {
		local, err := api.db.Queries.GetStorageRoot(ctx, root.ID)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		if local.Managed == root.Managed && local.Path != nil {
			if err := staged.SetRestoredStorageRootPath(ctx, database.SetRestoredStorageRootPathParams{Path: local.Path, ID: root.ID}); err != nil {
				return err
			}
		}
	}
	for _, doc := range documents {
		for _, field := range []*string{doc.Filepath, doc.Coverfile} {
			if field != nil {
				*field, _ = storagepath.NormalizeLegacy(*field)
			}
		}
		if doc.Filepath == nil {
			doc.StorageRootID = nil
		} else if doc.StorageRootID == nil {
			id := libraryRoot
			doc.StorageRootID = &id
		}
		if err := staged.SetRestoredDocumentPaths(ctx, database.SetRestoredDocumentPathsParams{
			ID: doc.ID, Filepath: doc.Filepath, StorageRootID: doc.StorageRootID, Coverfile: doc.Coverfile,
		}); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, dbmigrations.AutoImportRulesSchema); err != nil {
		return err
	}
	// Restored Schedules - Confirm the new mounts before resuming automatic imports.
	if err := staged.PauseRestoredImportRules(ctx); err != nil {
		return err
	}
	// Interrupted Jobs - A snapshot may include the job that wrote it; no worker resumes after restore.
	if err := staged.InterruptRunningAdminJobs(ctx, new(jobTime(time.Now()))); err != nil {
		return err
	}
	return tx.Commit()
}

func installRestoreFiles(ctx context.Context, source, dest string, paths *backupPaths, cleanup *[]func()) error {
	root, err := os.OpenRoot(dest)
	if err != nil {
		return err
	}
	defer root.Close()
	return filepath.WalkDir(source, func(name string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		rel, err := filepath.Rel(source, name)
		if err != nil {
			return err
		}
		if d.IsDir() {
			if rel == "." {
				return nil
			}
			if err := root.MkdirAll(rel, 0700); err != nil {
				return err
			}
			return syncRestoreDirectory(root, filepath.Dir(rel))
		}
		parent, err := root.OpenRoot(filepath.Dir(rel))
		if err != nil {
			return err
		}
		defer parent.Close()
		installed, created, err := installRestoreFile(ctx, name, parent, filepath.Base(rel), paths.prefix == "documents/library/")
		if err != nil {
			return err
		}
		newRel := filepath.Join(filepath.Dir(rel), installed)
		if created {
			*cleanup = append(*cleanup, func() {
				if root, err := os.OpenRoot(dest); err == nil {
					defer root.Close()
					_ = root.Remove(newRel)
				}
			})
		}
		if rel != newRel {
			paths.mapped[filepath.ToSlash(rel)] = filepath.ToSlash(newRel)
		}
		return nil
	})
}

func installRestoreFile(ctx context.Context, source string, dest *os.Root, name string, book bool) (string, bool, error) {
	from, err := os.Open(source)
	if err != nil {
		return "", false, err
	}
	defer from.Close()
	existing, err := dest.Lstat(name)
	if err == nil && book && existing.Mode().IsRegular() {
		current, err := dest.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK, 0)
		if err != nil {
			return "", false, err
		}
		liveHash, err := utils.CalculatePartialMD5Reader(current)
		current.Close()
		if err != nil {
			return "", false, err
		}
		backupHash, err := utils.CalculatePartialMD5Reader(from)
		if err != nil {
			return "", false, err
		}
		if *liveHash == *backupHash {
			return name, false, nil
		}
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", false, err
	}
	token, err := randomCSRF()
	if err != nil {
		return "", false, err
	}
	if existing != nil {
		name = "restore-" + token + filepath.Ext(name)
	}
	tmp := ".restore-" + token
	out, err := dest.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", false, err
	}
	defer dest.Remove(tmp)
	_, err = io.Copy(out, contextReader{ctx, from})
	if err == nil {
		err = out.Sync()
	}
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", false, err
	}
	if err := ctx.Err(); err != nil {
		return "", false, err
	}
	// No Clobber - Even if another writer creates the target during the copy, never replace a live file.
	if err := dest.Link(tmp, name); err != nil {
		return "", false, err
	}
	if err := syncRestoreDirectory(dest, "."); err != nil {
		_ = dest.Remove(name)
		return "", false, err
	}
	return name, true, nil
}

func syncRestoreDirectory(root *os.Root, name string) error {
	dir, err := root.Open(name)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func (s *webAPI) ApplyAdminRestore(ctx context.Context, r ApplyAdminRestoreRequestObject) (ApplyAdminRestoreResponseObject, error) {
	principal := webUser(ctx)
	api := s.api
	if !principal.IsAdmin || api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	if r.Body == nil || !adminJobID.MatchString(r.Body.Token) {
		return nil, adminFailure(400, "invalid_request")
	}
	if !api.restoreGate.TryLock() {
		return nil, adminFailure(409, "server_busy")
	}
	defer api.restoreGate.Unlock()
	if !api.restoreStage.TryLock() {
		return nil, adminFailure(409, "restore_busy")
	}
	defer api.restoreStage.Unlock()
	stage := filepath.Join(api.adminBackupDir(), "restore-ready")
	owner, err := os.ReadFile(filepath.Join(stage, "owner"))
	if err != nil || string(owner) != principal.UserName+"\x00"+principal.AuthHash {
		return nil, adminFailure(404, "restore_not_found")
	}
	token, err := os.ReadFile(filepath.Join(stage, "token"))
	if err != nil || string(token) != r.Body.Token {
		return nil, adminFailure(404, "restore_not_found")
	}
	if info, err := os.Stat(filepath.Join(stage, "token")); err != nil || time.Since(info.ModTime()) > time.Hour {
		return nil, adminFailure(404, "restore_expired")
	}
	req := requestContext(ctx)
	admin, err := api.db.Queries.GetStorageAdminByAuthHash(req, database.GetStorageAdminByAuthHashParams{ID: principal.UserName, AuthHash: &principal.AuthHash})
	if err != nil || !admin {
		return nil, adminFailure(403, "forbidden")
	}
	active, err := api.db.Queries.HasRunningStorageJobs(req, jobTime(time.Now()))
	if err != nil {
		return nil, err
	}
	if active {
		return nil, adminFailure(409, "server_busy")
	}
	if err := api.validateRestoreDB(req, filepath.Join(stage, adminBackupName)); err != nil {
		return nil, adminFailure(400, "incompatible_restore_database")
	}
	confirmed, err := os.ReadFile(filepath.Join(stage, "library-path"))
	if err != nil {
		return nil, adminFailure(404, "restore_not_found")
	}
	library, err := api.restoreLibraryPath(req, stage)
	if err != nil {
		return nil, err
	}
	if library != string(confirmed) {
		return nil, adminFailure(409, "restore_library_changed")
	}
	if err := api.applyStagedRestore(req, stage, library); err != nil {
		return nil, err
	}
	_ = os.RemoveAll(stage)
	_ = api.anonymousSession(sessions.Default(ginContext(ctx)))
	return ApplyAdminRestore204Response{}, nil
}

// RestoreFreshInstance - The dev launcher calls this before it serves requests. The
// fresh database supplies local paths; no path stored in a backup grants access.
func (api *API) RestoreFreshInstance(ctx context.Context, input io.Reader) error {
	var hasAccounts bool
	if err := api.db.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users)`).Scan(&hasAccounts); err != nil {
		return err
	}
	if hasAccounts {
		return errors.New("startup restore requires a fresh database")
	}
	if err := ensurePrivateAdminDir(api.adminBackupDir()); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(api.adminBackupDir(), "restore-local-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	if _, err := api.stageRestore(ctx, input, stage); err != nil {
		return err
	}
	library, err := api.restoreLibraryPath(ctx, stage)
	if err != nil {
		return err
	}
	return api.applyStagedRestore(ctx, stage, library)
}

func (api *API) applyStagedRestore(req context.Context, stage, library string) error {
	original := filepath.Join(stage, adminBackupName)
	if err := api.checkRestorePageSize(req, original); err != nil {
		return adminFailure(400, "incompatible_restore_database")
	}
	apply, err := os.CreateTemp(stage, "apply-")
	if err != nil {
		return err
	}
	name := apply.Name()
	defer os.Remove(name)
	source, err := os.Open(original)
	if err != nil {
		apply.Close()
		return err
	}
	_, err = io.Copy(apply, contextReader{req, source})
	source.Close()
	closeErr := apply.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	db, err := sql.Open("sqlite", name+"?_pragma=trusted_schema(OFF)")
	if err != nil {
		return err
	}
	err = api.prepareRestoreCatalog(req, db)
	if err == nil {
		// Rotate in the staged database so no restored data is visible under the old generation.
		err = database.New(db).RotateRestoredReadingGeneration(req)
	}
	defer db.Close()
	if err != nil {
		return adminFailure(400, "invalid_restore_data")
	}
	books, covers := newBackupPaths("documents/library/"), newBackupPaths("covers/")
	var cleanup []func()
	defer func() {
		for _, remove := range cleanup {
			remove()
		}
	}()
	if library != "" {
		if err := installRestoreFiles(req, filepath.Join(stage, "documents", libraryRoot), library, books, &cleanup); err != nil {
			return err
		}
	}
	if dir := filepath.Join(stage, "covers"); isDirectory(dir) {
		if err := installRestoreFiles(req, dir, filepath.Join(api.cfg.DataPath, "covers"), covers, &cleanup); err != nil {
			return err
		}
	}
	docs, err := database.New(db).ListDocumentsForRestore(req)
	if err != nil {
		return err
	}
	if err := rewriteBackupPaths(req, db, docs, books, covers); err != nil {
		return err
	}
	if err := db.Close(); err != nil {
		return err
	}
	conn, err := api.db.DB.Conn(req)
	if err != nil {
		return err
	}
	defer conn.Close()
	err = conn.Raw(func(raw any) error {
		driver, ok := raw.(interface {
			NewRestore(string) (*sqlite.Backup, error)
		})
		if !ok {
			return errors.New("SQLite restore unavailable")
		}
		backup, err := driver.NewRestore(snapshotURI(name))
		if err != nil {
			return err
		}
		for {
			if err = req.Err(); err != nil {
				_ = backup.Finish()
				return err
			}
			more, err := backup.Step(256)
			if err != nil {
				_ = backup.Finish()
				return err
			}
			if !more {
				return backup.Finish()
			}
		}
	})
	if err == nil {
		cleanup = nil
	}
	return err
}
