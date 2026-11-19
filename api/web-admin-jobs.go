package api

import (
	"context"
	"database/sql"
	"errors"
	"time"

	log "github.com/sirupsen/logrus"
)

const adminJobFields = `id,kind,status,started_at,finished_at`
const adminJobLifetime = 5 * time.Minute

func jobTime(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func scanAdminJob(row interface{ Scan(...any) error }) (AdminJob, error) {
	var job AdminJob
	err := row.Scan(&job.Id, &job.Kind, &job.Status, &job.StartedAt, &job.FinishedAt)
	return job, err
}

func (s *webAPI) ListAdminJobs(ctx context.Context, r ListAdminJobsRequestObject) (ListAdminJobsResponseObject, error) {
	if !webUser(ctx).IsAdmin {
		return nil, adminFailure(403, "forbidden")
	}
	kind := ""
	if r.Params.Kind != nil {
		kind = string(*r.Params.Kind)
	}
	rows, err := s.api.db.DB.QueryContext(requestContext(ctx), `SELECT id,kind,CASE WHEN status='running' AND deadline<=?1 THEN 'interrupted' ELSE status END,started_at,CASE WHEN status='running' AND deadline<=?1 THEN deadline ELSE finished_at END FROM admin_jobs WHERE (?2='' OR kind=?2) ORDER BY started_at DESC,id DESC LIMIT 20`, jobTime(time.Now()), kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(ListAdminJobs200JSONResponse, 0)
	for rows.Next() {
		job, err := scanAdminJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, job)
	}
	return out, rows.Err()
}

func (s *webAPI) StartAdminJob(ctx context.Context, r StartAdminJobRequestObject) (StartAdminJobResponseObject, error) {
	if !webUser(ctx).IsAdmin || s.api.cfg.DemoMode {
		return nil, adminFailure(403, "forbidden")
	}
	if r.Body == nil || (r.Body.Kind != "statistics" && r.Body.Kind != "database_check" && r.Body.Kind != "backup" && r.Body.Kind != "full_backup" && r.Body.Kind != "import") {
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
	var job AdminJob
	var started bool
	now := time.Now()
	err := s.adminTransaction(ctx, func(ctx context.Context, tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE admin_jobs SET status='interrupted',finished_at=deadline WHERE status='running' AND deadline<=?`, jobTime(now)); err != nil {
			return err
		}
		var err error
		job, err = scanAdminJob(tx.QueryRowContext(ctx, `SELECT `+adminJobFields+` FROM admin_jobs WHERE kind=? AND status='running'`, kind))
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		id, err := randomCSRF()
		if err != nil {
			return err
		}
		job, err = scanAdminJob(tx.QueryRowContext(ctx, `INSERT INTO admin_jobs(id,kind,status,started_at,deadline) VALUES(?,?,'running',?,?) RETURNING `+adminJobFields, id, kind, jobTime(now), jobTime(now.Add(adminJobLifetime))))
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM admin_jobs WHERE kind=?1 AND status<>'running' AND id NOT IN (SELECT id FROM admin_jobs WHERE kind=?1 ORDER BY started_at DESC,id DESC LIMIT 20)`, kind)
		started = err == nil
		return err
	})
	if err != nil {
		return nil, err
	}
	if started {
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
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()
	status := "succeeded"
	work := api.db.CacheTempTables
	switch kind {
	case "database_check":
		work = api.checkDatabaseIntegrity
	case "backup":
		work = api.createAdminBackup
	case "full_backup":
		work = api.createFullBackup
	case "import":
		work = func(ctx context.Context) error {
			return api.runLibraryImport(ctx, id, source, reference, relink)
		}
	}
	if err := api.runAdminWork(ctx, kind, work); err != nil {
		status = "failed"
		log.WithField("kind", kind).Warn("Admin job failed")
	}
	finish, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	if _, err := api.db.DB.ExecContext(finish, `UPDATE admin_jobs SET status=?,finished_at=? WHERE id=? AND status='running'`, status, jobTime(time.Now()), id); err != nil {
		log.Error("Could not record admin job completion: ", err)
	}
}

func (api *API) runAdminWork(ctx context.Context, kind string, work func(context.Context) error) error {
	api.restoreGate.RLock()
	defer api.restoreGate.RUnlock()
	if kind == "full_backup" || kind == "import" {
		if !api.libraryWrite.TryLock() {
			return errors.New("library busy")
		}
		defer api.libraryWrite.Unlock()
	}
	return work(ctx)
}
