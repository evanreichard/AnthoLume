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
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"modernc.org/sqlite"
	"reichard.io/antholume/database"
	dbmigrations "reichard.io/antholume/database/migrations"
	"reichard.io/antholume/pkg/storagepath"
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

func extractRestore(ctx context.Context, input, stage string) (int, error) {
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
	if err != nil || closeErr != nil {
		return 0, errors.New("restore upload failed")
	}
	if bytes > maxBackupArchiveBytes {
		return 0, adminFailure(413, "restore_too_large")
	}
	files, err := extractRestore(ctx, file.Name(), stage)
	if err != nil {
		return 0, adminFailure(400, "invalid_restore_archive")
	}
	if err = api.validateRestoreDB(ctx, filepath.Join(stage, adminBackupName)); err != nil {
		return 0, adminFailure(400, "incompatible_restore_database")
	}
	return files, nil
}

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
	return StageAdminRestore200JSONResponse{Token: token, Files: files}, nil
}

func archivedRootIDs(stage string) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(stage, "documents"))
	ids := []string{}
	if errors.Is(err, os.ErrNotExist) {
		return ids, nil
	}
	if err != nil {
		return nil, err
	}
	if len(entries) > 32 {
		return nil, errors.New("too many archived roots")
	}
	for _, entry := range entries {
		if !entry.IsDir() || !storageRootID.MatchString(entry.Name()) {
			return nil, errors.New("invalid archive root")
		}
		ids = append(ids, entry.Name())
	}
	return ids, nil
}

func (api *API) prepareRestoreLocations(ctx context.Context, db *sql.DB, stage, prefix string) (map[string]string, error) {
	queries := database.New(db)
	roots, err := queries.ListStorageRootsForRestore(ctx)
	if err != nil {
		return nil, err
	}
	archived := make(map[string]database.ListStorageRootsForRestoreRow, len(roots))
	for _, root := range roots {
		if !storageRootID.MatchString(root.ID) || root.Managed != (root.ID == libraryRoot) {
			return nil, errors.New("invalid snapshot storage root")
		}
		archived[root.ID] = root
	}
	if _, ok := archived[libraryRoot]; !ok {
		return nil, errors.New("missing snapshot library root")
	}

	mapped := map[string]AdminStorageRoot{}
	ids, err := archivedRootIDs(stage)
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		if id != libraryRoot {
			return nil, errors.New("external files are not restorable")
		}
		local, err := api.storageRoot(ctx, libraryRoot)
		if err != nil || !isDirectory(local.Path) {
			return nil, errors.New("library destination unavailable")
		}
		mapped[id] = local
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	staged := queries.WithTx(tx)
	// Keep only mappings the local administrator configured; a snapshot cannot grant filesystem access.
	if err := staged.ClearSnapshotStorageRootPaths(ctx); err != nil {
		return nil, err
	}
	for id, root := range archived {
		local, err := api.db.Queries.GetStorageRoot(ctx, id)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if err == nil && local.Managed == root.Managed && local.Path != nil {
			if err := staged.SetRestoredStorageRootPath(ctx, database.SetRestoredStorageRootPathParams{Path: local.Path, ID: id}); err != nil {
				return nil, err
			}
		}
	}
	for _, target := range mapped {
		if _, ok := archived[target.Id]; ok {
			continue
		}
		if err := staged.InsertRestoredStorageRoot(ctx, database.InsertRestoredStorageRootParams{ID: target.Id, Label: target.Label, Path: &target.Path}); err != nil {
			return nil, err
		}
	}

	documents, err := staged.ListDocumentsForRestore(ctx)
	if err != nil {
		return nil, err
	}
	consumed := map[string]bool{}
	defaultRoot := libraryRoot
	for i := range documents {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		doc := &documents[i]
		root := doc.StorageRootID
		if root == nil {
			root = &defaultRoot
		}
		if _, ok := archived[*root]; !ok {
			return nil, errors.New("document has unknown root")
		}
		for _, field := range []*string{doc.Filepath, doc.Coverfile} {
			if field == nil {
				continue
			}
			canonical, ok := storagepath.NormalizeLegacy(*field)
			if !ok {
				return nil, errors.New("invalid document or cover path")
			}
			*field = canonical
		}
		if local, ok := mapped[*root]; ok && !doc.Deleted && doc.Filepath != nil {
			archivedName := *root + "/" + *doc.Filepath
			if info, err := os.Stat(filepath.Join(stage, "documents", filepath.FromSlash(archivedName))); err == nil && info.Mode().IsRegular() {
				consumed[archivedName] = true
				relative := prefix + "/" + archivedName
				doc.Filepath, root = &relative, &local.Id
			}
		}
		if doc.Coverfile != nil && *doc.Coverfile != "UNKNOWN" {
			if info, err := os.Stat(filepath.Join(stage, "covers", filepath.FromSlash(*doc.Coverfile))); err == nil && info.Mode().IsRegular() {
				relative := prefix + "/" + *doc.Coverfile
				doc.Coverfile = &relative
			}
		}
		if doc.Filepath == nil {
			root = nil
		}
		doc.StorageRootID = root
	}
	for _, id := range ids {
		err := fs.WalkDir(os.DirFS(filepath.Join(stage, "documents")), id, func(name string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !entry.IsDir() && !consumed[name] {
				return errors.New("archived file does not belong to a managed book")
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	for _, doc := range documents {
		if err := staged.SetRestoredDocumentPaths(ctx, database.SetRestoredDocumentPathsParams{
			ID: doc.ID, Filepath: doc.Filepath, StorageRootID: doc.StorageRootID, Coverfile: doc.Coverfile,
		}); err != nil {
			return nil, err
		}
	}
	if _, err := tx.ExecContext(ctx, dbmigrations.AutoImportRulesSchema); err != nil {
		return nil, err
	}
	// Restored Schedules - Confirm the new mounts before resuming automatic imports.
	if err := staged.PauseRestoredImportRules(ctx); err != nil {
		return nil, err
	}
	// Interrupted Jobs - A snapshot may include the job that wrote it; no worker resumes after restore.
	finishedAt := jobTime(time.Now())
	if err := staged.InterruptRunningAdminJobs(ctx, &finishedAt); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	out := map[string]string{}
	for id, root := range mapped {
		out[id] = root.Path
	}
	return out, nil
}

func installRestoreFiles(ctx context.Context, source, dest string) error {
	if err := os.Mkdir(dest, 0700); err != nil {
		return err
	}
	var dirs []string
	err := filepath.WalkDir(source, func(name string, d fs.DirEntry, err error) error {
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
		to := filepath.Join(dest, rel)
		if d.IsDir() {
			dirs = append(dirs, to)
			if rel == "." {
				return nil
			}
			return os.Mkdir(to, 0700)
		}
		from, err := os.Open(name)
		if err != nil {
			return err
		}
		defer from.Close()
		out, err := os.OpenFile(to, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		_, err = io.Copy(out, contextReader{ctx, from})
		if err == nil {
			err = out.Sync()
		}
		if closeErr := out.Close(); err == nil {
			err = closeErr
		}
		return err
	})
	if err != nil {
		return err
	}
	for i := len(dirs) - 1; i >= 0; i-- {
		if err := syncAdminDirectory(dirs[i]); err != nil {
			return err
		}
	}
	return syncAdminDirectory(filepath.Dir(dest))
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
	if err := api.adminRecoverySnapshot(req, "before-restore-"); err != nil {
		return nil, err
	}
	if err := api.applyStagedRestore(req, stage, r.Body.Token); err != nil {
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
	token, err := randomCSRF()
	if err != nil {
		return err
	}
	return api.applyStagedRestore(ctx, stage, token)
}

func (api *API) applyStagedRestore(req context.Context, stage, token string) error {
	original := filepath.Join(stage, adminBackupName)
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
	prefix := "restore-" + token
	db, err := sql.Open("sqlite", name+"?_pragma=trusted_schema(OFF)")
	if err != nil {
		return err
	}
	roots, err := api.prepareRestoreLocations(req, db, stage, prefix)
	if err == nil {
		// Rotate in the staged database so no restored data is visible under the old generation.
		err = database.New(db).RotateRestoredReadingGeneration(req)
	}
	closeErr = db.Close()
	if err != nil || closeErr != nil {
		return adminFailure(400, "invalid_restore_data")
	}

	var destinations []string
	committed := false
	defer func() {
		if !committed {
			for _, dir := range destinations {
				_ = os.RemoveAll(dir)
			}
		}
	}()
	install := func(from, base, source string) error {
		to := filepath.Join(base, prefix)
		if source != "" {
			sub := filepath.Join(to, source)
			if err := os.Mkdir(to, 0700); err == nil {
				destinations = append(destinations, to)
				if err := syncAdminDirectory(base); err != nil {
					return err
				}
			} else if !slices.Contains(destinations, to) {
				return err
			}
			return installRestoreFiles(req, from, sub)
		}
		if _, err := os.Lstat(to); !errors.Is(err, os.ErrNotExist) {
			return errors.New("restore destination already exists")
		}
		destinations = append(destinations, to)
		return installRestoreFiles(req, from, to)
	}
	for source, base := range roots {
		if err := install(filepath.Join(stage, "documents", source), base, source); err != nil {
			return err
		}
	}
	if isDirectory(filepath.Join(stage, "covers")) {
		if err := install(filepath.Join(stage, "covers"), filepath.Join(api.cfg.DataPath, "covers"), ""); err != nil {
			return err
		}
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
				committed = true
				return backup.Finish()
			}
		}
	})
	return err
}
