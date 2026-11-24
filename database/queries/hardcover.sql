-- name: GetHardcoverCredential :one
SELECT l.credential FROM account_identities a
LEFT JOIN hardcover_links l ON l.account_id = a.account_id
WHERE a.account_id = sqlc.arg(account_id)
AND EXISTS (SELECT 1 FROM reading_generation g WHERE g.singleton = 1 AND g.generation = sqlc.arg(generation));

-- name: InsertHardcoverCredential :execrows
INSERT INTO hardcover_links (account_id, credential)
SELECT a.account_id, CAST(sqlc.arg(credential) AS BLOB) FROM account_identities a
WHERE a.account_id = sqlc.arg(account_id)
AND EXISTS (SELECT 1 FROM reading_generation g WHERE g.singleton = 1 AND g.generation = sqlc.arg(generation))
ON CONFLICT(account_id) DO NOTHING;

-- name: ReplaceHardcoverCredential :execrows
UPDATE hardcover_links SET credential = sqlc.arg(credential)
WHERE account_id = sqlc.arg(account_id) AND credential = sqlc.arg(previous)
AND EXISTS (SELECT 1 FROM reading_generation g WHERE g.singleton = 1 AND g.generation = sqlc.arg(generation));

-- name: RemoveHardcoverCredential :one
DELETE FROM hardcover_links WHERE account_id = sqlc.arg(account_id)
AND EXISTS (SELECT 1 FROM reading_generation g WHERE g.singleton = 1 AND g.generation = sqlc.arg(generation))
RETURNING credential;

-- name: GetHardcoverLinkForUserDeletion :one
SELECT a.account_id, g.generation, h.credential
FROM account_identities a CROSS JOIN reading_generation g
LEFT JOIN hardcover_links h ON h.account_id = a.account_id
WHERE a.user_id = ? AND g.singleton = 1;

-- name: ClearHardcoverLinks :exec
DELETE FROM hardcover_links;
