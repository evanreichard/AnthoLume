-- name: GetMissingDocuments :many
SELECT documents.* FROM documents
WHERE documents.filepath IS NOT NULL AND documents.deleted = false
    AND documents.id NOT IN (SELECT value FROM json_each(CAST(sqlc.arg(document_ids) AS TEXT)));

-- name: GetDeletedDocuments :many
SELECT documents.id FROM documents
WHERE documents.deleted = true
    AND documents.id IN (SELECT value FROM json_each(CAST(sqlc.arg(document_ids) AS TEXT)));

-- name: GetWantedDocuments :many
SELECT
    CAST(value AS TEXT) AS id,
    CAST((documents.filepath IS NULL) AS BOOLEAN) AS want_file,
    CAST((documents.id IS NULL) AS BOOLEAN) AS want_metadata
FROM json_each(CAST(sqlc.arg(document_ids) AS TEXT))
LEFT JOIN documents ON value = documents.id
WHERE (documents.deleted = false AND documents.filepath IS NULL) OR documents.id IS NULL;
