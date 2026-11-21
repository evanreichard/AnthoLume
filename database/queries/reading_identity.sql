-- name: CountUsersByID :one
SELECT count(*) FROM users WHERE id = ?;

-- name: CountAccountIdentities :one
SELECT count(*) FROM account_identities WHERE user_id = ? AND account_id = ?;

-- name: CountLiveDocuments :one
SELECT count(*) FROM documents WHERE id = ? AND deleted = 0;

-- name: GetReadingDeviceName :one
SELECT device_name FROM devices WHERE user_id = ? AND id = ?;

-- name: RegisterReadingDevice :exec
INSERT INTO devices (id, user_id, device_name)
VALUES (?, ?, ?)
ON CONFLICT (user_id, id) DO UPDATE SET
    device_name = excluded.device_name,
    last_synced = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now');

-- name: GetReadingHead :one
SELECT
    CAST(h.revision AS TEXT) AS revision,
    h.position,
    h.fraction,
    h.device_id,
    h.updated_at,
    s.user_id IS NOT NULL AS has_device_snapshot,
    s.external_id AS external_device_id,
    COALESCE(s.device_name, d.device_name, '') AS device_name
FROM reading_heads h
LEFT JOIN reading_head_devices s ON s.user_id = h.user_id AND s.document_id = h.document_id
LEFT JOIN devices d ON d.user_id = h.user_id AND d.id = h.device_id
WHERE h.user_id = ? AND h.document_id = ?;

-- name: GetReadingReceipt :one
SELECT digest, status, revision, code, current_revision
FROM reading_receipts
WHERE user_id = ? AND event_id = ?;

-- name: InsertReadingReceipt :exec
INSERT INTO reading_receipts (
    user_id, event_id, document_id, kind, payload_version, payload, digest,
    observed_at, status, revision, code, current_revision
)
VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?);

-- name: UpsertReadingHead :exec
INSERT INTO reading_heads (user_id, document_id, revision, position, fraction, device_id, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, document_id) DO UPDATE SET
    revision = excluded.revision,
    position = excluded.position,
    fraction = excluded.fraction,
    device_id = excluded.device_id,
    updated_at = excluded.updated_at;

-- name: UpsertReadingHeadDevice :exec
INSERT INTO reading_head_devices (user_id, document_id, external_id, device_name)
VALUES (?, ?, ?, ?)
ON CONFLICT (user_id, document_id) DO UPDATE SET
    external_id = excluded.external_id,
    device_name = excluded.device_name;

-- name: InsertReadingActivity :exec
INSERT INTO activity (user_id, document_id, device_id, start_time, duration, start_percentage, end_percentage)
VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: EnsureReadingDocument :exec
INSERT OR IGNORE INTO documents (id) VALUES (?);

-- name: GetReadingHeadUpdatedAt :one
SELECT CAST(updated_at AS TEXT) AS updated_at
FROM reading_heads WHERE user_id = ? AND document_id = ?;

-- name: GetSessionIdentity :one
SELECT a.account_id, u.admin, u.timezone
FROM users u
JOIN account_identities a ON a.user_id = u.id
JOIN reading_generation g ON g.singleton = 1 AND g.generation = sqlc.arg(generation)
WHERE u.id = sqlc.arg(user_id) AND u.auth_hash = sqlc.arg(auth_hash);

-- name: GetReadingGeneration :one
SELECT generation FROM reading_generation WHERE singleton = 1;

-- name: IsFirstUser :one
SELECT count(*) = 0 FROM users;

-- name: InsertIdentityUser :exec
INSERT INTO users (id, pass, auth_hash, admin) VALUES (?, ?, ?, ?);

-- name: UpdateSessionTimezone :execrows
UPDATE users SET timezone = sqlc.arg(timezone)
WHERE id = sqlc.arg(user_id) AND auth_hash = sqlc.arg(auth_hash);

-- name: UpdateSessionPassword :execrows
UPDATE users SET pass = sqlc.arg(pass), auth_hash = sqlc.arg(new_auth_hash)
WHERE id = sqlc.arg(user_id) AND auth_hash = sqlc.arg(current_auth_hash);

-- name: ListManagedReadingDevices :many
SELECT
    d.id,
    d.device_name,
    COALESCE(p.label, '') AS label,
    COALESCE(p.archived, 0) AS archived,
    d.last_synced
FROM devices d
LEFT JOIN device_preferences p ON p.user_id = d.user_id AND p.device_id = d.id
WHERE d.user_id = ? AND d.id <> ''
ORDER BY d.last_synced DESC, d.id ASC
LIMIT 501;

-- name: GetManagedReadingDevice :one
SELECT
    d.id,
    d.device_name,
    COALESCE(p.label, '') AS label,
    COALESCE(p.archived, 0) AS archived,
    d.last_synced
FROM devices d
LEFT JOIN device_preferences p ON p.user_id = d.user_id AND p.device_id = d.id
WHERE d.user_id = ? AND d.id = ?;

-- name: UpsertReadingDevicePreferences :exec
INSERT INTO device_preferences (user_id, device_id, label, archived)
SELECT d.user_id, d.id, sqlc.arg(label), sqlc.arg(archived)
FROM devices d
WHERE d.user_id = sqlc.arg(user_id) AND d.id = sqlc.arg(device_id)
ON CONFLICT (user_id, device_id) DO UPDATE SET
    label = excluded.label,
    archived = excluded.archived;
