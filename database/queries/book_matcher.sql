-- name: CountBookMatcherDocuments :one
SELECT count(*) FROM documents WHERE deleted = 0;

-- name: ListBookMatcherDocuments :many
SELECT d.id, d.title, d.author, d.isbn13, d.isbn10,
    CAST(COALESCE((SELECT value FROM document_identifiers
        WHERE document_id = d.id AND namespace = sqlc.arg(namespace)
        ORDER BY value LIMIT 1), '') AS TEXT) AS work_id
FROM documents d
WHERE d.deleted = 0
ORDER BY NULLIF(trim(d.title), '') COLLATE NOCASE ASC NULLS LAST, d.id ASC
LIMIT 10 OFFSET sqlc.arg(page_offset);

-- name: GetBookMatcherDocuments :many
SELECT d.id, d.title, d.author, d.isbn13, d.isbn10,
    CAST(COALESCE((SELECT value FROM document_identifiers
        WHERE document_id = d.id AND namespace = sqlc.arg(namespace)
        ORDER BY value LIMIT 1), '') AS TEXT) AS work_id
FROM documents d
WHERE d.deleted = 0 AND d.id IN (sqlc.slice('document_ids'));

-- name: UnlinkBookMatcherDocument :exec
DELETE FROM document_identifiers
WHERE document_id = sqlc.arg(document_id) AND namespace = sqlc.arg(namespace) AND value = sqlc.arg(work_id);
