-- name: GetShelfmarkEnabled :one
SELECT CAST(COALESCE((SELECT value FROM settings WHERE name = 'shelfmark_enabled'), 'true') AS TEXT);

-- name: ClaimShelfmarkRequest :one
INSERT INTO shelfmark_requests (provider, book_id, title, author, description, year, has_cover, username, requested_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (provider, book_id) DO NOTHING
RETURNING *;

-- name: GetShelfmarkRequest :one
SELECT * FROM shelfmark_requests WHERE provider = ? AND book_id = ?;

-- name: CompleteShelfmarkRequest :execrows
UPDATE shelfmark_requests SET remote_id = sqlc.arg(remote_id)
WHERE sequence = sqlc.arg(sequence) AND remote_id IS NULL;

-- name: ReleaseShelfmarkRequest :execrows
DELETE FROM shelfmark_requests WHERE sequence = ? AND remote_id IS NULL;

-- name: ListShelfmarkRequests :many
SELECT * FROM shelfmark_requests ORDER BY sequence DESC LIMIT 51 OFFSET sqlc.arg(page_offset);

-- name: FindShelfmarkRequests :many
SELECT r.* FROM json_each(CAST(sqlc.arg(book_keys) AS TEXT)) AS k
JOIN shelfmark_requests AS r ON r.provider = json_extract(k.value, '$[0]') AND r.book_id = json_extract(k.value, '$[1]');
