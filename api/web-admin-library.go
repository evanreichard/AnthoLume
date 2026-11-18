package api

import (
	"archive/zip"
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

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
	var total int64
	entries := 0
	add := func(name string, file *os.File) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		info, err := file.Stat()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Size() > maxLibraryBackup-total || entries >= 50000 {
			return errors.New("backup exceeds file limits")
		}
		total += info.Size()
		entries++
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
	for _, folder := range []string{"documents", "covers"} {
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

func (api *API) importFolder(ctx context.Context, directory string) (*os.Root, []string, error) {
	if directory == "" {
		directory = "."
	}
	if !filepath.IsLocal(directory) {
		return nil, nil, adminFailure(400, "invalid_import_folder")
	}
	root, err := os.OpenRoot(filepath.Join(api.cfg.DataPath, "imports"))
	if err != nil {
		return nil, nil, adminFailure(404, "import_folder_not_found")
	}
	folder, err := root.OpenRoot(directory)
	root.Close()
	if err != nil {
		return nil, nil, adminFailure(404, "import_folder_not_found")
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
	if !webUser(ctx).IsAdmin {
		return nil, adminFailure(403, "forbidden")
	}
	root, files, err := s.api.importFolder(requestContext(ctx), r.Params.Directory)
	if err != nil {
		return nil, err
	}
	root.Close()
	return PreviewAdminImport200JSONResponse(files), nil
}

func (api *API) importBook(ctx context.Context, root *os.Root, base, name string, reference bool) (AdminImportResultStatus, error) {
	source, err := root.Open(name)
	if err != nil {
		return "failed", err
	}
	defer source.Close()
	info, err := source.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > metadata.MaxDocumentSize {
		return "failed", errors.New("invalid source file")
	}
	temp, err := os.CreateTemp(filepath.Join(api.cfg.DataPath, "documents"), "import-*.epub")
	if err != nil {
		return "failed", err
	}
	kept := false
	defer func() {
		temp.Close()
		if !kept {
			os.Remove(temp.Name())
		}
	}()
	if n, err := io.Copy(temp, io.LimitReader(contextReader{ctx, source}, metadata.MaxDocumentSize+1)); err != nil || n != info.Size() {
		return "failed", errors.New("incomplete import")
	}
	if err := temp.Sync(); err != nil {
		return "failed", err
	}
	if err := temp.Close(); err != nil {
		return "failed", err
	}
	m, err := metadata.GetMetadata(temp.Name())
	if err != nil {
		return "failed", err
	}
	var basepath *string
	target := filepath.Base(temp.Name())
	if reference {
		basepath = &base
		target = name
	}
	res, err := api.db.DB.ExecContext(ctx, `INSERT INTO documents(id,md5,filepath,basepath,title,author,description,words) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, *m.PartialMD5, m.MD5, target, basepath, m.Title, m.Author, m.Description, m.WordCount)
	if err != nil {
		return "failed", err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return "failed", err
	}
	if n == 0 {
		return "skipped", nil
	}
	kept = !reference
	return "imported", nil
}

var adminJobID = regexp.MustCompile(`^[a-f0-9]{64}$`)

func (api *API) runLibraryImport(ctx context.Context, id, directory string, reference bool) error {
	root, files, err := api.importFolder(ctx, directory)
	if err != nil {
		return err
	}
	defer root.Close()
	base, err := filepath.Abs(filepath.Join(api.cfg.DataPath, "imports", directory))
	if err != nil {
		return err
	}
	results := make([]AdminImportResult, 0, len(files))
	for _, file := range files {
		if err := ctx.Err(); err != nil {
			return err
		}
		status, _ := api.importBook(ctx, root, base, file, reference)
		results = append(results, AdminImportResult{File: file, Status: status})
	}
	encoded, err := json.Marshal(results)
	if err != nil {
		return err
	}
	_, err = api.db.DB.ExecContext(ctx, `UPDATE admin_jobs SET result=? WHERE id=? AND status='running'`, encoded, id)
	return err
}

func (s *webAPI) ListAdminImportResults(ctx context.Context, r ListAdminImportResultsRequestObject) (ListAdminImportResultsResponseObject, error) {
	if !webUser(ctx).IsAdmin {
		return nil, adminFailure(403, "forbidden")
	}
	if !adminJobID.MatchString(r.Params.Job) {
		return nil, adminFailure(400, "invalid_request")
	}
	var result []byte
	if err := s.api.db.DB.QueryRowContext(requestContext(ctx), `SELECT result FROM admin_jobs WHERE id=? AND kind='import' AND status='succeeded'`, r.Params.Job).Scan(&result); errors.Is(err, sql.ErrNoRows) {
		return nil, adminFailure(404, "job_not_found")
	} else if err != nil {
		return nil, err
	}
	rows := ListAdminImportResults200JSONResponse{}
	err := json.Unmarshal(result, &rows)
	return rows, err
}

func (s *webAPI) ListAdminLogs(ctx context.Context, _ ListAdminLogsRequestObject) (ListAdminLogsResponseObject, error) {
	if !webUser(ctx).IsAdmin {
		return nil, adminFailure(403, "forbidden")
	}
	out := ListAdminLogs200JSONResponse{}
	f, err := os.Open(filepath.Join(s.api.cfg.ConfigPath, "logs", "antholume.log"))
	if errors.Is(err, os.ErrNotExist) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("log is not a regular file")
	}
	const capBytes = 512 << 10
	start := max(int64(0), info.Size()-capBytes)
	scan := bufio.NewScanner(io.NewSectionReader(f, start, capBytes))
	scan.Buffer(make([]byte, 4096), capBytes)
	if start > 0 {
		scan.Scan()
	}
	for scan.Scan() {
		var line struct {
			Time   string `json:"time"`
			Level  string `json:"level"`
			Type   string `json:"type"`
			Method string `json:"method"`
			Status int    `json:"status"`
		}
		if json.Unmarshal(scan.Bytes(), &line) != nil {
			continue
		}
		parsed, err := time.Parse(time.RFC3339, line.Time)
		if err != nil {
			continue
		}
		switch line.Level {
		case "debug", "info", "warn", "error", "fatal", "panic", "trace":
		default:
			continue
		}
		operation := "Server event"
		if line.Type == "access" && line.Status >= 100 && line.Status <= 599 {
			operation = "HTTP " + strconv.Itoa(line.Status)
		}
		out = append(out, AdminLog{Time: parsed.Format(time.RFC3339), Level: line.Level, Operation: operation})
		if len(out) > 100 {
			out = out[1:]
		}
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, scan.Err()
}
