-- name: GetMetadataProvider :one
SELECT CAST(COALESCE((SELECT provider FROM metadata_provider WHERE id = 1), 'openlibrary') AS TEXT) AS provider;

-- name: SetMetadataProvider :exec
INSERT INTO metadata_provider (id, provider) VALUES (1, ?)
ON CONFLICT(id) DO UPDATE SET provider = excluded.provider;

-- name: RemoveOtherDocumentIdentifiers :exec
DELETE FROM document_identifiers
WHERE document_id = ? AND namespace = ? AND value <> ?;

-- name: LinkDocumentIdentifier :exec
INSERT INTO document_identifiers (document_id, namespace, value)
VALUES (?, ?, ?) ON CONFLICT DO NOTHING;

-- name: ListDocumentIdentifiers :many
SELECT namespace, value FROM document_identifiers
WHERE document_id = ? ORDER BY namespace, value;
