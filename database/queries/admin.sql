-- name: GetAdminSessionRole :one
SELECT admin FROM users WHERE id = sqlc.arg(id) AND auth_hash = sqlc.arg(auth_hash);

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
SET name = ?, root_id = ?, enabled = ?, watch = ?, interval_minutes = ?, reference = ?, next_scan = ?, status = 'idle', last_scan = NULL
WHERE id = ?;

-- name: QueueAutoImportRule :execrows
UPDATE auto_import_rules SET next_scan = ? WHERE id = ? AND enabled;

-- name: DeleteAutoImportRule :execrows
DELETE FROM auto_import_rules WHERE id = ?;

-- name: ListAutoImportRules :many
SELECT id, name, root_id, enabled, watch, interval_minutes, reference, last_scan, next_scan, status
FROM auto_import_rules
ORDER BY name COLLATE NOCASE, id;

-- name: ListEnabledAutoImportRules :many
SELECT id, name, root_id, enabled, watch, interval_minutes, reference, last_scan, next_scan, status
FROM auto_import_rules
WHERE enabled
ORDER BY COALESCE(next_scan, ''), id;

-- name: GetEnabledAutoImportRule :one
SELECT id, name, root_id, enabled, watch, interval_minutes, reference, last_scan, next_scan, status
FROM auto_import_rules
WHERE id = ? AND enabled;

-- name: RecordAutoImportScan :exec
UPDATE auto_import_rules SET last_scan = ?, next_scan = ?, status = ? WHERE id = ?;
