-- name: GetMetadataProvider :one
SELECT CAST(COALESCE((SELECT value FROM settings WHERE name = 'metadata_provider'), 'openlibrary') AS TEXT) AS provider;

-- name: RemoveOtherDocumentIdentifiers :exec
DELETE FROM document_identifiers
WHERE document_id = ? AND namespace = ? AND value <> ?;

-- name: LinkDocumentIdentifier :exec
INSERT INTO document_identifiers (document_id, namespace, value)
VALUES (?, ?, ?) ON CONFLICT DO NOTHING;

-- name: ListDocumentIdentifiers :many
SELECT namespace, value FROM document_identifiers
WHERE document_id = ? ORDER BY namespace, value;

-- name: ListDocumentIdentifiersForPage :many
SELECT document_id, namespace, value
FROM document_identifiers
WHERE document_id IN (sqlc.slice('document_ids'))
ORDER BY document_id, namespace, value;
