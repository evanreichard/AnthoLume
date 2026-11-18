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
	"strings"
	"time"

	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"modernc.org/sqlite"
)

func (api *API) adminFileBoundary(c *gin.Context) {
	if c.Request.Method == http.MethodPatch && c.Request.URL.Path == "/api/v1/admin/restore" {
		c.Next()
		return
	}
	api.adminFiles.RLock()
	defer api.adminFiles.RUnlock()
	c.Next()
}

func snapshotURI(name string) string {
	return (&url.URL{Scheme: "file", Path: name, RawQuery: "mode=ro&_pragma=trusted_schema(OFF)"}).String()
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
	if err != nil || !reflect.DeepEqual(expected, actual) {
		return errors.New("restore requires a database with this server's schema")
	}
	var integrity string
	if err := db.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&integrity); err != nil || integrity != "ok" {
		return errors.New("snapshot integrity check failed")
	}
	var admins int
	if err := db.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE admin=1 AND length(pass)>0`).Scan(&admins); err != nil || admins == 0 {
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
	if len(archive.File) > 50001 {
		return 0, errors.New("archive has too many entries")
	}
	seen := map[string]bool{}
	var expanded uint64
	count := 0
	for _, file := range archive.File {
		name := file.Name
		if name != "antholume.db" && !(strings.HasPrefix(name, "documents/") || strings.HasPrefix(name, "covers/")) {
			return 0, errors.New("unexpected backup entry")
		}
		if !fs.ValidPath(name) || strings.Contains(name, "\\") || len(name) > 512 || seen[name] || !file.Mode().IsRegular() {
			return 0, errors.New("invalid backup entry")
		}
		seen[name] = true
		if file.UncompressedSize64 > maxLibraryBackup-expanded || (name == adminBackupName && file.UncompressedSize64 > maxAdminBackupBytes) {
			return 0, errors.New("archive size limit")
		}
		expanded += file.UncompressedSize64
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
	file, err := os.CreateTemp(stage, "upload-")
	if err != nil {
		return nil, err
	}
	bytes, err := io.Copy(file, io.LimitReader(contextReader{ctx, r.Body}, maxLibraryBackup+(32<<20)+1))
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		return nil, errors.New("restore upload failed")
	}
	if bytes > maxLibraryBackup+(32<<20) {
		return nil, adminFailure(413, "restore_too_large")
	}
	files, err := extractRestore(ctx, file.Name(), stage)
	if err != nil {
		return nil, adminFailure(400, "invalid_restore_archive")
	}
	_ = os.Remove(file.Name())
	if err = api.validateRestoreDB(ctx, filepath.Join(stage, adminBackupName)); err != nil {
		return nil, adminFailure(400, "incompatible_restore_database")
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

func (api *API) restoreDocumentPaths(ctx context.Context, db *sql.DB, stage, prefix string) error {
	rows, err := db.QueryContext(ctx, `SELECT id,filepath,basepath,coverfile FROM documents`)
	if err != nil {
		return err
	}
	type change struct {
		id                string
		book, base, cover sql.NullString
	}
	var updates []change
	managed, err := filepath.Abs(filepath.Join(api.cfg.DataPath, "documents"))
	if err != nil {
		rows.Close()
		return err
	}
	imports, err := filepath.Abs(filepath.Join(api.cfg.DataPath, "imports"))
	if err != nil {
		rows.Close()
		return err
	}
	for rows.Next() {
		var u change
		if err := rows.Scan(&u.id, &u.book, &u.base, &u.cover); err != nil {
			rows.Close()
			return err
		}
		for _, name := range []sql.NullString{u.book, u.cover} {
			if name.Valid && name.String != "" && (!fs.ValidPath(name.String) || strings.Contains(name.String, "\\") || name.String == ".") {
				rows.Close()
				return errors.New("invalid document path in snapshot")
			}
		}
		isManaged := !u.base.Valid || u.base.String == "" || filepath.Clean(u.base.String) == managed
		if isManaged {
			u.base = sql.NullString{}
			if u.book.Valid && prefix != "" {
				if file, err := os.Stat(filepath.Join(stage, "documents", u.book.String)); err == nil && file.Mode().IsRegular() {
					u.book.String = prefix + "/" + u.book.String
				} else {
					u.book = sql.NullString{}
				}
			}
		} else {
			resolved, err := filepath.EvalSymlinks(u.base.String)
			if err != nil {
				u.base = sql.NullString{}
				u.book = sql.NullString{}
			} else {
				rel, err := filepath.Rel(imports, resolved)
				if err != nil || !filepath.IsLocal(rel) {
					u.base = sql.NullString{}
					u.book = sql.NullString{}
				}
			}
		}
		if u.cover.Valid && u.cover.String != "UNKNOWN" && prefix != "" {
			if file, err := os.Stat(filepath.Join(stage, "covers", u.cover.String)); err == nil && file.Mode().IsRegular() {
				u.cover.String = prefix + "/" + u.cover.String
			} else {
				u.cover = sql.NullString{}
			}
		}
		updates = append(updates, u)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, u := range updates {
		if _, err := tx.ExecContext(ctx, `UPDATE documents SET filepath=?,basepath=?,coverfile=? WHERE id=?`, u.book, u.base, u.cover, u.id); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET auth_hash=lower(hex(randomblob(32)))`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE admin_jobs SET status='interrupted',finished_at=? WHERE status='running'`, jobTime(time.Now())); err != nil {
		return err
	}
	return tx.Commit()
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
	if !api.adminFiles.TryLock() {
		return nil, adminFailure(409, "server_busy")
	}
	defer api.adminFiles.Unlock()
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
	var admin bool
	if err := api.db.DB.QueryRowContext(req, `SELECT admin FROM users WHERE id=? AND auth_hash=?`, principal.UserName, principal.AuthHash).Scan(&admin); err != nil || !admin {
		return nil, adminFailure(403, "forbidden")
	}
	active := 0
	if err := api.db.DB.QueryRowContext(req, `SELECT count(*) FROM admin_jobs WHERE status='running' AND deadline>?`, jobTime(time.Now())).Scan(&active); err != nil {
		return nil, err
	}
	if active > 0 {
		return nil, adminFailure(409, "server_busy")
	}
	original := filepath.Join(stage, adminBackupName)
	if err := api.validateRestoreDB(req, original); err != nil {
		return nil, adminFailure(400, "incompatible_restore_database")
	}
	if err := api.adminRecoverySnapshot(req, "before-restore-"); err != nil {
		return nil, err
	}
	apply, err := os.CreateTemp(stage, "apply-")
	if err != nil {
		return nil, err
	}
	name := apply.Name()
	defer os.Remove(name)
	source, err := os.Open(original)
	if err != nil {
		apply.Close()
		return nil, err
	}
	_, err = io.Copy(apply, contextReader{req, source})
	source.Close()
	closeErr := apply.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
	}
	prefix := ""
	var destinations []string
	committed := false
	defer func() {
		if !committed {
			for _, dir := range destinations {
				_ = os.RemoveAll(dir)
			}
		}
	}()
	for _, kind := range []string{"documents", "covers"} {
		if _, err := os.Stat(filepath.Join(stage, kind)); err == nil {
			prefix = "restore-" + r.Body.Token
			break
		}
	}
	if prefix != "" {
		for _, kind := range []string{"documents", "covers"} {
			from := filepath.Join(stage, kind)
			if _, err := os.Stat(from); errors.Is(err, os.ErrNotExist) {
				continue
			}
			to := filepath.Join(api.cfg.DataPath, kind, prefix)
			if _, err := os.Lstat(to); !errors.Is(err, os.ErrNotExist) {
				return nil, errors.New("restore destination already exists")
			}
			destinations = append(destinations, to)
			if err := installRestoreFiles(req, from, to); err != nil {
				return nil, err
			}
		}
	}
	db, err := sql.Open("sqlite", name+"?_pragma=trusted_schema(OFF)")
	if err != nil {
		return nil, err
	}
	err = api.restoreDocumentPaths(req, db, stage, prefix)
	db.Close()
	if err != nil {
		return nil, adminFailure(400, "invalid_restore_data")
	}
	conn, err := api.db.DB.Conn(req)
	if err != nil {
		return nil, err
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
	if err != nil {
		return nil, err
	}
	_ = os.RemoveAll(stage)
	_ = api.anonymousSession(sessions.Default(ginContext(ctx)))
	return ApplyAdminRestore204Response{}, nil
}
