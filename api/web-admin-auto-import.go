package api

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
)

const autoImportQuiet = 5 * time.Second

func autoImportResponse(row database.AutoImportRule) AdminAutoImport {
	return AdminAutoImport{
		Id:       row.ID,
		LastScan: row.LastScan,
		NextScan: row.NextScan,
		Status:   AdminAutoImportStatus(row.Status),
		Settings: AdminAutoImportSettings{
			Name:            row.Name,
			RootId:          row.RootID,
			Enabled:         row.Enabled,
			Watch:           row.Watch,
			IntervalMinutes: int(row.IntervalMinutes),
			Reference:       row.Reference,
		},
	}
}

func (api *API) autoImportSource(ctx context.Context, id string) (AdminStorageRoot, error) {
	root, err := api.storageRoot(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return root, adminFailure(404, "storage_root_not_found")
	}
	if err == nil && root.Managed {
		return root, adminFailure(400, "invalid_import_source")
	}
	return root, err
}

func (s *webAPI) ListAdminAutoImports(ctx context.Context, _ ListAdminAutoImportsRequestObject) (ListAdminAutoImportsResponseObject, error) {
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	rules, err := s.api.autoImportRules(requestContext(ctx), false)
	return ListAdminAutoImports200JSONResponse(rules), err
}

func (s *webAPI) SaveAdminAutoImport(ctx context.Context, r SaveAdminAutoImportRequestObject) (SaveAdminAutoImportResponseObject, error) {
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	if r.Body == nil {
		return nil, adminFailure(400, "invalid_request")
	}
	cfg := *r.Body
	cfg.Name = strings.TrimSpace(cfg.Name)
	if cfg.Name == "" {
		return nil, adminFailure(400, "invalid_request")
	}
	req := requestContext(ctx)
	if _, err := s.api.autoImportSource(req, cfg.RootId); err != nil {
		return nil, err
	}
	if cfg.Enabled {
		dir, err := s.api.openImportSource(req, cfg.RootId)
		if err != nil {
			return nil, err
		}
		dir.Close()
	}
	if cfg.Enabled && !cfg.Reference {
		if _, err := s.api.importDestination(req, cfg.RootId, false); err != nil {
			return nil, err
		}
	}
	id := ""
	if r.Params.Id != nil {
		id = *r.Params.Id
	}
	err := s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		q := s.api.db.Queries.WithTx(tx)
		if cfg.Enabled {
			overlap, err := q.HasAutoImportOverlap(ctx, database.HasAutoImportOverlapParams{
				RootID:    cfg.RootId,
				ExcludeID: id,
			})
			if err != nil {
				return err
			}
			if overlap {
				return adminFailure(409, "auto_import_overlap")
			}
		}
		var next *string
		if cfg.Enabled {
			now := jobTime(time.Now())
			next = &now
		}
		if id == "" {
			count, err := q.CountAutoImportRules(ctx)
			if err != nil {
				return err
			}
			if count >= 100 {
				return adminFailure(409, "auto_import_rule_limit")
			}
			var random [16]byte
			if _, err := rand.Read(random[:]); err != nil {
				return err
			}
			return q.CreateAutoImportRule(ctx, database.CreateAutoImportRuleParams{
				ID:              hex.EncodeToString(random[:]),
				Name:            cfg.Name,
				RootID:          cfg.RootId,
				Enabled:         cfg.Enabled,
				Watch:           cfg.Watch,
				IntervalMinutes: int64(cfg.IntervalMinutes),
				Reference:       cfg.Reference,
				NextScan:        next,
			})
		}
		n, err := q.UpdateAutoImportRule(ctx, database.UpdateAutoImportRuleParams{
			ID:              id,
			Name:            cfg.Name,
			RootID:          cfg.RootId,
			Enabled:         cfg.Enabled,
			Watch:           cfg.Watch,
			IntervalMinutes: int64(cfg.IntervalMinutes),
			Reference:       cfg.Reference,
			NextScan:        next,
		})
		return autoImportMutation(n, err, "auto_import_not_found", 404)
	})
	if err != nil {
		return nil, err
	}
	return SaveAdminAutoImport204Response{}, nil
}

func autoImportMutation(n int64, err error, code string, status int) error {
	if err == nil && n == 0 {
		return adminFailure(status, code)
	}
	return err
}

func (s *webAPI) QueueAdminAutoImport(ctx context.Context, r QueueAdminAutoImportRequestObject) (QueueAdminAutoImportResponseObject, error) {
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	next := jobTime(time.Now())
	n, err := s.api.db.Queries.QueueAutoImportRule(requestContext(ctx), database.QueueAutoImportRuleParams{
		ID:       r.Params.Id,
		NextScan: &next,
	})
	if err := autoImportMutation(n, err, "auto_import_disabled", 409); err != nil {
		return nil, err
	}
	return QueueAdminAutoImport204Response{}, nil
}

func (s *webAPI) DeleteAdminAutoImport(ctx context.Context, r DeleteAdminAutoImportRequestObject) (DeleteAdminAutoImportResponseObject, error) {
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	n, err := s.api.db.Queries.DeleteAutoImportRule(requestContext(ctx), r.Params.Id)
	if err := autoImportMutation(n, err, "auto_import_not_found", 404); err != nil {
		return nil, err
	}
	return DeleteAdminAutoImport204Response{}, nil
}

func (api *API) autoImportRules(ctx context.Context, enabled bool) ([]AdminAutoImport, error) {
	var rows []database.AutoImportRule
	var err error
	if enabled {
		rows, err = api.db.Queries.ListEnabledAutoImportRules(ctx)
	} else {
		rows, err = api.db.Queries.ListAutoImportRules(ctx)
	}
	if err != nil {
		return nil, err
	}
	out := make([]AdminAutoImport, 0, len(rows))
	for _, row := range rows {
		out = append(out, autoImportResponse(row))
	}
	return out, nil
}

type observedImportFile struct {
	size     int64
	modified time.Time
}
type autoImportCache struct {
	source    string
	reference bool
	files     map[string]observedImportFile
}

func (api *API) runAutoImport(ctx context.Context, id string, caches map[string]autoImportCache) bool {
	if !api.restoreGate.TryRLock() {
		return false
	}
	defer api.restoreGate.RUnlock()
	if !api.libraryWrite.TryLock() {
		return false
	}
	defer api.libraryWrite.Unlock()
	ctx, cancel := context.WithTimeout(ctx, adminJobLifetime)
	defer cancel()
	q := api.db.Queries
	cfg, err := q.GetEnabledAutoImportRule(ctx, id)
	if err != nil {
		return false
	}
	if active, err := q.HasActiveAdminImportJob(ctx, jobTime(time.Now())); err != nil || active {
		return false
	}
	source, err := api.autoImportSource(ctx, cfg.RootID)
	status := "complete"
	var retry bool
	if err == nil {
		cache := caches[id]
		if cache.source != source.Path || cache.reference != cfg.Reference || cache.files == nil {
			cache = autoImportCache{source.Path, cfg.Reference, map[string]observedImportFile{}}
		}
		seen := map[string]observedImportFile{}
		candidates := map[string]observedImportFile{}
		results, scanErr := api.importBooks(ctx, cfg.RootID, cfg.Reference, false, func(root *os.Root, name string) bool {
			info, statErr := root.Stat(name)
			if statErr != nil {
				retry = true
				return false
			}
			signature := observedImportFile{info.Size(), info.ModTime()}
			if old, ok := cache.files[name]; ok && old == signature {
				seen[name] = signature
				return false
			}
			if time.Since(info.ModTime()) < autoImportQuiet && !info.ModTime().After(time.Now()) {
				retry = true
				return false
			}
			candidates[name] = signature
			return true
		})
		err = scanErr
		if err == nil {
			for _, result := range results {
				if result.Status == "failed" {
					status = "errors"
					continue
				}
				seen[result.File] = candidates[result.File]
			}
			cache.files = seen
			caches[id] = cache
		}
	}
	if err != nil {
		status = "unavailable"
		delete(caches, id)
	}
	if ctx.Err() != nil {
		return false
	}
	now := time.Now()
	delay := time.Duration(cfg.IntervalMinutes) * time.Minute
	if retry {
		delay = min(delay, autoImportQuiet)
	}
	last, next := jobTime(now), jobTime(now.Add(delay))
	return q.RecordAutoImportScan(ctx, database.RecordAutoImportScanParams{
		ID:       id,
		LastScan: &last,
		NextScan: &next,
		Status:   status,
	}) == nil
}

// RunAutoImports owns one watcher and one scan loop for the server lifetime.
func (api *API) RunAutoImports(ctx context.Context) {
	if api.cfg.DemoMode {
		return
	}
	watcher, err := fsnotify.NewWatcher()
	var events <-chan fsnotify.Event
	var watchErrors <-chan error
	if err == nil {
		defer watcher.Close()
		events, watchErrors = watcher.Events, watcher.Errors
	} else {
		log.Warn("Auto-import filesystem watch unavailable; scheduled scans remain active")
	}
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	watches := map[string][]string{}
	pending := map[string]time.Time{}
	caches := map[string]autoImportCache{}
	var refresh time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			for _, id := range watches[filepath.Dir(event.Name)] {
				pending[id] = time.Now().Add(autoImportQuiet)
			}
			if event.Has(fsnotify.Create) || event.Has(fsnotify.Remove) || event.Has(fsnotify.Rename) {
				refresh = time.Time{}
			}
		case _, ok := <-watchErrors:
			if !ok {
				watchErrors = nil
				continue
			}
			refresh = time.Time{}
		case now := <-tick.C:
			rows, err := api.autoImportRules(ctx, true)
			if err != nil {
				continue
			}
			registering := false
			for _, row := range rows {
				registering = registering || row.Settings.Watch && row.LastScan == nil
			}
			if watcher != nil && (registering || !now.Before(refresh)) {
				watches = api.updateImportWatches(ctx, watcher, rows)
				refresh = now.Add(15 * time.Second)
			}
			enabled := map[string]bool{}
			for _, row := range rows {
				id := row.Id
				enabled[id] = true
				eventTime, hasEvent := pending[id]
				due := row.NextScan == nil || *row.NextScan <= jobTime(now)
				if !row.Settings.Watch {
					delete(pending, id)
				}
				if due || row.Settings.Watch && hasEvent && !now.Before(eventTime) {
					if api.runAutoImport(ctx, id, caches) {
						delete(pending, id)
					}
				}
			}
			for id := range pending {
				if !enabled[id] {
					delete(pending, id)
				}
			}
			for id := range caches {
				if !enabled[id] {
					delete(caches, id)
				}
			}
		}
	}
}

func (api *API) updateImportWatches(ctx context.Context, watcher *fsnotify.Watcher, rows []AdminAutoImport) map[string][]string {
	paths := map[string][]string{}
	for _, row := range rows {
		cfg := row.Settings
		if !cfg.Watch {
			continue
		}
		folder, err := api.openImportSource(ctx, cfg.RootId)
		if err != nil {
			continue
		}
		base, err := filepath.Abs(folder.Name())
		if err != nil {
			folder.Close()
			continue
		}
		var dirs int
		_ = fs.WalkDir(folder.FS(), ".", func(name string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if entry.IsDir() {
				dirs++
				if dirs > 1024 {
					return fs.SkipAll
				}
				path := filepath.Join(base, filepath.FromSlash(name))
				if len(paths[path]) == 0 {
					if err := watcher.Add(path); err != nil {
						return fs.SkipDir
					}
				}
				paths[path] = append(paths[path], row.Id)
			}
			return nil
		})
		folder.Close()
	}
	for _, path := range watcher.WatchList() {
		if len(paths[path]) == 0 {
			_ = watcher.Remove(path)
		}
	}
	return paths
}
