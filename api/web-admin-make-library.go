package api

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"reichard.io/antholume/database"
)

func (api *API) makeLibraryPlan(ctx context.Context, q database.DBTX, id, proposedPath string) (MakeLibraryPlan, error) {
	out := MakeLibraryPlan{Id: id}
	if id == libraryRoot {
		return out, adminFailure(400, "invalid_library_source")
	}
	candidate, err := api.queryStorageRoot(ctx, q, id)
	if errors.Is(err, sql.ErrNoRows) {
		return out, adminFailure(404, "storage_root_not_found")
	}
	if err != nil {
		return out, err
	}
	if candidate.Managed {
		return out, adminFailure(400, "invalid_library_source")
	}
	out.ConfiguredSourcePath = candidate.Path
	if proposedPath == "" {
		proposedPath = candidate.Path
	}
	sourcePath, err := storageDirectory(proposedPath)
	if err != nil {
		return out, err
	}
	current, err := api.queryStorageRoot(ctx, q, libraryRoot)
	if err != nil {
		return out, err
	}
	out.SourcePath, out.LibraryPath = sourcePath, current.Path
	candidateInfo, err := os.Stat(sourcePath)
	if err != nil {
		return out, err
	}
	currentInfo, err := os.Stat(current.Path)
	out.SameFolder = err == nil && os.SameFile(candidateInfo, currentInfo)
	if !out.SameFolder {
		from, err := filepath.EvalSymlinks(sourcePath)
		if err != nil {
			return out, err
		}
		prior, err := filepath.EvalSymlinks(current.Path)
		if err != nil {
			prior = current.Path
		}
		if foldersOverlap(from, prior) {
			return out, adminFailure(409, "library_folders_overlap")
		}
	}
	counts, err := database.New(q).GetMakeLibraryCounts(ctx, &id)
	out.Incoming, out.Outgoing, out.PausedRules = int(counts.Incoming), int(counts.Outgoing), int(counts.PausedRules)
	if out.SameFolder {
		out.Outgoing = 0
	}
	return out, err
}

func foldersOverlap(a, b string) bool {
	within := func(base, path string) bool {
		rel, err := filepath.Rel(base, path)
		return err == nil && (rel == "." || filepath.IsLocal(rel) && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
	}
	return within(a, b) || within(b, a)
}

func (s *webAPI) PreviewMakeLibrary(ctx context.Context, r PreviewMakeLibraryRequestObject) (PreviewMakeLibraryResponseObject, error) {
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	proposed := ""
	if r.Params.Path != nil {
		proposed = *r.Params.Path
	}
	plan, err := s.api.makeLibraryPlan(requestContext(ctx), s.api.db.DB, r.Params.Id, proposed)
	if err != nil {
		return nil, err
	}
	return PreviewMakeLibrary200JSONResponse(plan), nil
}

func (s *webAPI) MakeLibrary(ctx context.Context, r MakeLibraryRequestObject) (MakeLibraryResponseObject, error) {
	api := s.api
	if !webUser(ctx).IsAdmin || api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	if r.Body == nil {
		return nil, adminFailure(400, "invalid_request")
	}
	if !api.libraryWrite.TryLock() {
		return nil, adminFailure(409, "server_busy")
	}
	defer api.libraryWrite.Unlock()
	err := s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		plan, err := api.makeLibraryPlan(ctx, tx, r.Body.Id, r.Body.SourcePath)
		if err != nil {
			return err
		}
		if *r.Body != plan {
			return adminFailure(409, "library_plan_changed")
		}
		queries := api.db.Queries.WithTx(tx)
		active, err := queries.HasRunningStorageJobs(ctx, jobTime(time.Now()))
		if err != nil {
			return err
		}
		if active {
			return adminFailure(409, "server_busy")
		}
		probe, err := os.CreateTemp(plan.SourcePath, ".antholume-write-check-*")
		if err != nil {
			return adminFailure(400, "library_not_writable")
		}
		closeErr := probe.Close()
		removeErr := os.Remove(probe.Name())
		if closeErr != nil || removeErr != nil {
			return adminFailure(400, "library_not_writable")
		}
		if !plan.SameFolder {
			id, err := randomCSRF()
			if err != nil {
				return err
			}
			former := "former-" + id[:32]
			if err := queries.InsertFormerLibraryRoot(ctx, database.InsertFormerLibraryRootParams{ID: former, Path: &plan.LibraryPath}); err != nil {
				return err
			}
			if err := queries.MoveFormerLibraryDocuments(ctx, &former); err != nil {
				return err
			}
			if err := queries.SetLibraryRootPath(ctx, &plan.SourcePath); err != nil {
				return err
			}
		}
		if err := queries.MoveDocumentsIntoLibrary(ctx, &plan.Id); err != nil {
			return err
		}
		if err := queries.MovePausedImportRulesIntoLibrary(ctx, plan.Id); err != nil {
			return err
		}
		return queries.DeleteStorageRoot(ctx, plan.Id)
	})
	if err != nil {
		return nil, err
	}
	return MakeLibrary204Response{}, nil
}
