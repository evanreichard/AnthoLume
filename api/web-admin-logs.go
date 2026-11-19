package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

const logPageSize = 15
const logScanBudget = 4 << 20
const maxLogLine = 32 << 10

var rotatedLogName = regexp.MustCompile(`^antholume-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}\.log$`)
var logSecretKey = regexp.MustCompile(`(?i)(password|passwd|passphrase|authorization|cookie|token|secret|credential|api.?key|auth.?hash|private.?key|session.?id|csrf)`)
var logSecretText = regexp.MustCompile(`(?i)\b(password|passwd|passphrase|authorization|(?:set-)?cookie|(?:[\w.-]*[-_])?token|secret|credentials?|api[-_ ]?key|auth[-_ ]?hash|private[-_ ]?key|session[-_ ]?id|csrf)\b["']?\s*[:=]\s*[^\r\n]*|\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+`)
var logURLQuery = regexp.MustCompile(`((?:https?://|/)[^\s"'<>?]*)\?[^\s"'<>]+`)
var logURLCredentials = regexp.MustCompile(`(://)[^\s/@]+@`)

type logCursor struct {
	device, inode uint64
	offset        int64
}

func (c logCursor) encode() string {
	var b [24]byte
	binary.BigEndian.PutUint64(b[:8], c.device)
	binary.BigEndian.PutUint64(b[8:16], c.inode)
	binary.BigEndian.PutUint64(b[16:], uint64(c.offset))
	return base64.RawURLEncoding.EncodeToString(b[:])
}

func decodeLogCursor(value string) (logCursor, bool) {
	b, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(b) != 24 {
		return logCursor{}, false
	}
	c := logCursor{binary.BigEndian.Uint64(b[:8]), binary.BigEndian.Uint64(b[8:16]), int64(binary.BigEndian.Uint64(b[16:]))}
	return c, c.offset > 0
}

type reverseLog struct {
	file       *os.File
	pos        int64
	blockStart int64
	block      []byte
}

func (r *reverseLog) before(pos int64) ([]byte, error) {
	const blockSize = 32 << 10
	start := (pos - 1) / blockSize * blockSize
	if r.block == nil || r.blockStart != start {
		b := make([]byte, blockSize)
		n, _ := r.file.ReadAt(b, start)
		if int64(n) < pos-start {
			return nil, adminFailure(409, "log_cursor_expired")
		}
		r.block, r.blockStart = b[:n], start
	}
	return r.block[:pos-start], nil
}

func (r *reverseLog) next(ctx context.Context) ([]byte, error) {
	b, err := r.before(r.pos)
	if err != nil {
		return nil, err
	}
	if b[len(b)-1] == '\n' {
		r.pos--
	}
	var line []byte
	oversized := false
	for r.pos > 0 {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		b, err := r.before(r.pos)
		if err != nil {
			return nil, err
		}
		sep := bytes.LastIndexByte(b, '\n')
		prefix := b[sep+1:]
		if !oversized && len(prefix)+len(line) <= maxLogLine {
			if len(line) == 0 && (sep >= 0 || r.blockStart == 0) {
				r.pos = r.blockStart + int64(sep+1)
				return prefix, nil
			}
			line = append(bytes.Clone(prefix), line...)
		} else {
			oversized = true
			line = nil
		}
		r.pos = r.blockStart + int64(sep+1)
		if sep >= 0 {
			break
		}
	}
	return line, nil
}

func scrubLog(value any) any {
	switch v := value.(type) {
	case map[string]any:
		for key, child := range v {
			if logSecretKey.MatchString(key) {
				v[key] = "[redacted]"
			} else {
				v[key] = scrubLog(child)
			}
		}
	case []any:
		for i, child := range v {
			v[i] = scrubLog(child)
		}
	case string:
		return logSecretText.ReplaceAllString(logURLQuery.ReplaceAllString(logURLCredentials.ReplaceAllString(v, "$1[redacted]@"), "$1?[redacted]"), "[redacted]")
	}
	return value
}

func parseLogEntry(line []byte) (AdminLog, bool) {
	var fields map[string]any
	decoder := json.NewDecoder(bytes.NewReader(line))
	decoder.UseNumber()
	if decoder.Decode(&fields) != nil {
		return AdminLog{}, false
	}
	timestamp, _ := fields["time"].(string)
	parsed, err := time.Parse(time.RFC3339Nano, timestamp)
	if err != nil {
		return AdminLog{}, false
	}
	level, _ := fields["level"].(string)
	switch level {
	case "debug", "info", "warn", "error", "fatal", "panic", "trace":
	default:
		return AdminLog{}, false
	}
	scrubLog(fields)
	message, _ := fields["msg"].(string)
	if message == "" {
		message = "Server event"
	}
	details, err := json.MarshalIndent(fields, "", "  ")
	return AdminLog{Time: parsed.UTC().Format(time.RFC3339Nano), Level: AdminLogLevel(level), Message: message, Details: string(details)}, err == nil
}

func (s *webAPI) ListAdminLogs(ctx context.Context, req ListAdminLogsRequestObject) (ListAdminLogsResponseObject, error) {
	if !webUser(ctx).IsAdmin {
		return nil, adminFailure(403, "forbidden")
	}
	ctx = requestContext(ctx)
	var cursor logCursor
	if req.Params.Cursor != nil {
		var ok bool
		if cursor, ok = decodeLogCursor(*req.Params.Cursor); !ok {
			return nil, adminFailure(400, "invalid_request")
		}
	}
	term := ""
	if req.Params.Q != nil {
		term = strings.ToLower(strings.TrimSpace(*req.Params.Q))
	}
	dir := filepath.Join(s.api.cfg.ConfigPath, "logs")
	out := AdminLogPage{Entries: []AdminLog{}}
	files, err := os.ReadDir(dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	names := []string{"antholume.log"}
	for i := len(files) - 1; i >= 0; i-- {
		if files[i].Type().IsRegular() && rotatedLogName.MatchString(files[i].Name()) {
			names = append(names, files[i].Name())
		}
	}
	found := req.Params.Cursor == nil
	budget := int64(logScanBudget)
	for _, name := range names {
		f, err := os.OpenFile(filepath.Join(dir, name), os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		info, err := f.Stat()
		if err != nil {
			f.Close()
			return nil, err
		}
		if !info.Mode().IsRegular() {
			f.Close()
			continue
		}
		id := info.Sys().(*syscall.Stat_t)
		current := logCursor{uint64(id.Dev), uint64(id.Ino), info.Size()}
		if !found {
			if current.device != cursor.device || current.inode != cursor.inode {
				f.Close()
				continue
			}
			if cursor.offset > info.Size() {
				f.Close()
				return nil, adminFailure(409, "log_cursor_expired")
			}
			found, current.offset = true, cursor.offset
		}
		if current.offset == 0 {
			f.Close()
			continue
		}
		reader := reverseLog{file: f, pos: current.offset}
		for reader.pos > 0 && budget > 0 && len(out.Entries) < logPageSize {
			before := reader.pos
			line, err := reader.next(ctx)
			if err != nil {
				f.Close()
				return nil, err
			}
			budget -= before - reader.pos
			entry, ok := parseLogEntry(line)
			if ok && (req.Params.Level == nil || *req.Params.Level == entry.Level) && (term == "" || strings.Contains(strings.ToLower(entry.Details), term)) {
				out.Entries = append(out.Entries, entry)
			}
		}
		f.Close()
		if reader.pos > 0 {
			current.offset = reader.pos
			next := current.encode()
			out.NextCursor = &next
			break
		}
	}
	if !found {
		return nil, adminFailure(409, "log_cursor_expired")
	}
	return ListAdminLogs200JSONResponse(out), nil
}
