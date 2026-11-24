package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"

	log "github.com/sirupsen/logrus"
	"reichard.io/antholume/database"
)

const adminJobLifetime = 5 * time.Minute

type adminJobLifecycle struct {
	ctx     context.Context
	cancel  context.CancelFunc
	mu      sync.Mutex
	active  sync.WaitGroup
	drained chan struct{}
}

func (j *adminJobLifecycle) reserve() bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.ctx.Err() != nil {
		return false
	}
	j.active.Add(1)
	return true
}

func (j *adminJobLifecycle) stop() {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.ctx.Err() != nil {
		return
	}
	j.cancel()
	go func() {
		j.active.Wait()
		close(j.drained)
	}()
}

func (j *adminJobLifecycle) wait(ctx context.Context) error {
	select {
	case <-j.drained:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("drain admin jobs: %w", ctx.Err())
	}
}

func jobTime(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func adminJobResponse(id, kind, status, startedAt string, finishedAt *string) AdminJob {
	return AdminJob{
		Id:         id,
		Kind:       AdminJobKind(kind),
		Status:     AdminJobStatus(status),
		StartedAt:  startedAt,
		FinishedAt: finishedAt,
	}
}

func (s *webAPI) ListAdminJobs(ctx context.Context, r ListAdminJobsRequestObject) (ListAdminJobsResponseObject, error) {
	kind := ""
	if r.Params.Kind != nil {
		kind = string(*r.Params.Kind)
	}
	rows, err := s.api.db.Queries.ListAdminJobs(requestContext(ctx), database.ListAdminJobsParams{
		Now:  jobTime(time.Now()),
		Kind: kind,
	})
	if err != nil {
		return nil, err
	}
	out := make(ListAdminJobs200JSONResponse, 0, len(rows))
	for _, row := range rows {
		if row.Expired {
			row.Status, row.FinishedAt = "interrupted", &row.Deadline
		}
		out = append(out, adminJobResponse(row.ID, row.Kind, row.Status, row.StartedAt, row.FinishedAt))
	}
	return out, nil
}

func (s *webAPI) StartAdminJob(ctx context.Context, r StartAdminJobRequestObject) (StartAdminJobResponseObject, error) {
	if s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	if r.Body == nil || (r.Body.Kind != "statistics" && r.Body.Kind != "database_check" && r.Body.Kind != "import") {
		return nil, adminFailure(400, "invalid_request")
	}
	kind := string(r.Body.Kind)
	reference, relink := false, false
	source := importsRoot
	if kind == "import" {
		if r.Body.RelinkMissing != nil {
			relink = *r.Body.RelinkMissing
		}
		if r.Body.Reference != nil {
			reference = *r.Body.Reference
		}
		if r.Body.RootId != nil {
			source = *r.Body.RootId
		}
		if _, err := s.api.importDestination(requestContext(ctx), source, reference); err != nil {
			return nil, err
		}
		root, files, err := s.api.importFolder(requestContext(ctx), source)
		if err != nil {
			return nil, err
		}
		root.Close()
		if len(files) == 0 {
			return nil, adminFailure(400, "no_import_files")
		}
	}
	// Job Admission - Reserve before persisting a running row so shutdown cannot miss an accepted job.
	if !s.api.adminJobs.reserve() {
		return nil, adminFailure(503, "server_busy")
	}
	launched := false
	defer func() {
		if !launched {
			s.api.adminJobs.active.Done()
		}
	}()
	var job AdminJob
	var started bool
	now := time.Now()
	err := s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		q := s.api.db.Queries.WithTx(tx)
		if err := q.InterruptExpiredAdminJobs(ctx, jobTime(now)); err != nil {
			return err
		}
		running, err := q.GetRunningAdminJob(ctx, kind)
		if err == nil {
			job = adminJobResponse(running.ID, running.Kind, running.Status, running.StartedAt, running.FinishedAt)
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		id, err := randomCSRF()
		if err != nil {
			return err
		}
		created, err := q.CreateAdminJob(ctx, database.CreateAdminJobParams{
			ID:        id,
			Kind:      kind,
			StartedAt: jobTime(now),
			Deadline:  jobTime(now.Add(adminJobLifetime)),
		})
		if err != nil {
			return err
		}
		if err := q.PruneAdminJobs(ctx, kind); err != nil {
			return err
		}
		job = adminJobResponse(created.ID, created.Kind, created.Status, created.StartedAt, created.FinishedAt)
		started = true
		return nil
	})
	if err != nil {
		return nil, err
	}
	if started {
		launched = true
		go s.api.runAdminJob(job.Id, kind, source, reference, relink, now.Add(adminJobLifetime))
	}
	return StartAdminJob202JSONResponse(job), nil
}

func (api *API) checkDatabaseIntegrity(ctx context.Context) error {
	var result string
	if err := api.db.DB.QueryRowContext(ctx, `PRAGMA quick_check`).Scan(&result); err != nil {
		return err
	}
	if result != "ok" {
		return errors.New("database integrity check failed")
	}
	return nil
}

func (api *API) runAdminJob(id, kind, source string, reference, relink bool, deadline time.Time) {
	work := api.db.CacheTempTables
	switch kind {
	case "database_check":
		work = api.checkDatabaseIntegrity
	case "import":
		work = func(ctx context.Context) error {
			return api.runLibraryImport(ctx, id, source, reference, relink)
		}
	}
	api.finishAdminWork(id, kind, deadline, work)
}

func (api *API) finishAdminWork(id, kind string, deadline time.Time, work func(context.Context) error) {
	defer api.adminJobs.active.Done()
	ctx, cancel := context.WithDeadline(api.adminJobs.ctx, deadline)
	defer cancel()
	status := "succeeded"
	if err := api.runAdminWork(ctx, kind, work); err != nil {
		if ctx.Err() != nil {
			status = "interrupted"
		} else {
			status = "failed"
			log.WithField("kind", kind).Warn("Admin job failed")
		}
	}
	finish, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	finishedAt := jobTime(time.Now())
	if err := api.db.Queries.FinishAdminJob(finish, database.FinishAdminJobParams{
		ID:         id,
		Status:     status,
		FinishedAt: &finishedAt,
	}); err != nil {
		log.Error("Could not record admin job completion: ", err)
	}
}

func (api *API) runAdminWork(ctx context.Context, kind string, work func(context.Context) error) error {
	api.restoreGate.RLock()
	defer api.restoreGate.RUnlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	if kind == "import" {
		if !api.libraryWrite.TryLock() {
			return errors.New("library busy")
		}
		defer api.libraryWrite.Unlock()
	}
	return work(ctx)
}
