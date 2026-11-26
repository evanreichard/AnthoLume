-- name: GetShelfmarkEnabled :one
SELECT CAST(COALESCE((SELECT value FROM settings WHERE name = 'shelfmark_enabled'), 'true') AS TEXT);

-- name: ClaimShelfmarkRelease :one
INSERT INTO shelfmark_releases (
    source, release_key, release_title, format, size, language, indexer,
    provider, book_id, book_title, author, description, year, has_cover, username, requested_at, release_author
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (release_key) DO NOTHING
RETURNING *;

-- name: GetShelfmarkRelease :one
SELECT * FROM shelfmark_releases WHERE release_key = ?;

-- name: SetShelfmarkReleaseState :exec
UPDATE shelfmark_releases SET state = sqlc.arg(state)
WHERE release_key = sqlc.arg(release_key) AND state = 'unconfirmed';

-- name: CountShelfmarkBookRequests :one
SELECT COUNT(*) FROM shelfmark_releases WHERE provider = ? AND book_id = ?;

-- name: ListShelfmarkRequests :many
WITH recent AS (
    SELECT provider, book_id, book_title, author, description, year, has_cover, requested_at, release_key,
           CAST(COUNT(*) OVER (PARTITION BY provider, book_id) AS INTEGER) AS request_count,
           ROW_NUMBER() OVER (PARTITION BY provider, book_id ORDER BY requested_at DESC, release_key DESC) AS position
    FROM shelfmark_releases
)
SELECT provider, book_id, book_title, author, description, year, has_cover, request_count
FROM recent WHERE position = 1
ORDER BY requested_at DESC, release_key DESC LIMIT 51 OFFSET sqlc.arg(page_offset);

-- name: ListShelfmarkRequestedReleases :many
SELECT * FROM shelfmark_releases WHERE provider = ? AND book_id = ? ORDER BY requested_at DESC, release_key DESC;

-- name: CountShelfmarkBookReleases :many
SELECT r.provider, r.book_id, COUNT(*) AS request_count
FROM shelfmark_releases r
WHERE (r.provider, r.book_id) IN (
    SELECT json_extract(k.value, '$[0]'), json_extract(k.value, '$[1]')
    FROM json_each(CAST(sqlc.arg(book_keys) AS TEXT)) AS k
)
GROUP BY r.provider, r.book_id;

-- name: FindShelfmarkReleaseRequests :many
SELECT r.* FROM shelfmark_releases AS r
WHERE r.release_key IN (SELECT CAST(value AS TEXT) FROM json_each(CAST(sqlc.arg(release_keys) AS TEXT)));
