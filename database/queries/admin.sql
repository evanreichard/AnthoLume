-- name: ListAdminUsers :many
SELECT id, admin FROM users WHERE id > sqlc.arg(after_id) ORDER BY id LIMIT 51;

-- name: CreateAdminUser :execrows
INSERT INTO users (id, pass, auth_hash, admin)
VALUES (?, ?, ?, ?)
ON CONFLICT (id) DO NOTHING;

-- name: UpdateAdminUser :one
UPDATE users
SET
    pass = COALESCE(sqlc.narg(pass), pass),
    auth_hash = COALESCE(sqlc.narg(auth_hash), auth_hash),
    admin = COALESCE(sqlc.narg(admin), admin)
WHERE id = sqlc.arg(id)
RETURNING admin;

-- name: DeleteAdminUserStatistics :exec
DELETE FROM document_user_statistics WHERE user_id = ?;

-- name: DeleteAdminUserStreaks :exec
DELETE FROM user_streaks WHERE user_id = ?;

-- name: DeleteAdminUserProgress :exec
DELETE FROM document_progress WHERE user_id = ?;

-- name: ListAdminJobs :many
SELECT
    id,
    kind,
    status,
    started_at,
    finished_at,
    deadline,
    CAST(status = 'running' AND deadline <= sqlc.arg(now) AS BOOLEAN) AS expired
FROM admin_jobs
WHERE (kind = sqlc.arg(kind) OR sqlc.arg(kind) = '')
ORDER BY started_at DESC, id DESC
LIMIT 20;

-- name: InterruptExpiredAdminJobs :exec
UPDATE admin_jobs
SET status = 'interrupted', finished_at = deadline
WHERE status = 'running' AND deadline <= sqlc.arg(now);

-- name: GetRunningAdminJob :one
SELECT id, kind, status, started_at, finished_at FROM admin_jobs WHERE kind = ? AND status = 'running';

-- name: CreateAdminJob :one
INSERT INTO admin_jobs (id, kind, status, started_at, deadline)
VALUES (?, ?, 'running', ?, ?)
RETURNING id, kind, status, started_at, finished_at;

-- name: PruneAdminJobs :exec
DELETE FROM admin_jobs
WHERE admin_jobs.kind = sqlc.arg(kind) AND status <> 'running' AND id NOT IN (
    SELECT recent.id FROM admin_jobs AS recent WHERE recent.kind = sqlc.arg(kind)
    ORDER BY recent.started_at DESC, recent.id DESC LIMIT 20
);

-- name: FinishAdminJob :exec
UPDATE admin_jobs SET status = ?, finished_at = ? WHERE id = ? AND status = 'running';

-- name: HasActiveAdminImportJob :one
SELECT EXISTS (
    SELECT 1 FROM admin_jobs WHERE kind = 'import' AND status = 'running' AND deadline > sqlc.arg(now)
);

-- name: HasAutoImportOverlap :one
SELECT EXISTS (
    SELECT 1 FROM auto_import_rules WHERE enabled AND root_id = sqlc.arg(root_id) AND id <> sqlc.arg(exclude_id)
);

-- name: CountAutoImportRules :one
SELECT COUNT(*) FROM auto_import_rules;

-- name: CreateAutoImportRule :exec
INSERT INTO auto_import_rules (id, name, root_id, enabled, watch, interval_minutes, reference, next_scan)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);

-- name: UpdateAutoImportRule :execrows
UPDATE auto_import_rules
SET name = ?, root_id = ?, enabled = ?, watch = ?, interval_minutes = ?, reference = ?, next_scan = ?, status = 'idle', last_scan = NULL,
    books_added = NULL, source_total = NULL, last_scan_trigger = NULL, next_scan_trigger = NULL
WHERE id = ?;

-- name: QueueAutoImportRule :execrows
UPDATE auto_import_rules SET next_scan = ?, next_scan_trigger = 'manual' WHERE id = ? AND enabled;

-- name: DeleteAutoImportRule :execrows
DELETE FROM auto_import_rules WHERE id = ?;

-- name: ListAutoImportRules :many
SELECT id, name, root_id, enabled, watch, interval_minutes, reference, last_scan, next_scan, status, books_added, source_total, last_scan_trigger, next_scan_trigger
FROM auto_import_rules
ORDER BY name COLLATE NOCASE, id;

-- name: ListEnabledAutoImportRules :many
SELECT id, name, root_id, enabled, watch, interval_minutes, reference, last_scan, next_scan, status, books_added, source_total, last_scan_trigger, next_scan_trigger
FROM auto_import_rules
WHERE enabled
ORDER BY COALESCE(next_scan, ''), id;

-- name: GetEnabledAutoImportRule :one
SELECT id, name, root_id, enabled, watch, interval_minutes, reference, last_scan, next_scan, status, books_added, source_total, last_scan_trigger, next_scan_trigger
FROM auto_import_rules
WHERE id = ? AND enabled;

-- name: RecordAutoImportScan :exec
UPDATE auto_import_rules
SET last_scan = sqlc.narg(last_scan), status = sqlc.arg(status), books_added = sqlc.narg(books_added),
    source_total = sqlc.narg(source_total), last_scan_trigger = sqlc.narg(last_scan_trigger),
    next_scan = CASE WHEN next_scan IS sqlc.narg(previous_next_scan) THEN sqlc.narg(next_scan) ELSE next_scan END,
    next_scan_trigger = CASE WHEN next_scan IS sqlc.narg(previous_next_scan) THEN sqlc.narg(next_scan_trigger) ELSE next_scan_trigger END
WHERE id = sqlc.arg(id);
