-- name: GetMetadataProvider :one
SELECT CAST(COALESCE((SELECT provider FROM metadata_provider WHERE id = 1), 'openlibrary') AS TEXT) AS provider;

-- name: SetMetadataProvider :exec
INSERT INTO metadata_provider (id, provider) VALUES (1, ?)
ON CONFLICT(id) DO UPDATE SET provider = excluded.provider;

-- name: RemoveOtherHardcoverIdentifiers :exec
DELETE FROM document_identifiers
WHERE document_id = ? AND namespace = 'hardcover' AND value <> ?;

-- name: LinkHardcoverIdentifier :exec
INSERT INTO document_identifiers (document_id, namespace, value)
VALUES (?, 'hardcover', ?) ON CONFLICT DO NOTHING;

-- name: ApplyIdentifiedMetadata :exec
UPDATE documents
SET title = COALESCE(sqlc.narg(title), title),
    author = COALESCE(sqlc.narg(author), author),
    description = COALESCE(sqlc.narg(description), description),
    isbn10 = COALESCE(sqlc.narg(isbn10), isbn10),
    isbn13 = COALESCE(sqlc.narg(isbn13), isbn13)
WHERE id = sqlc.arg(id) AND deleted = 0;
