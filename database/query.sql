-- name: DeleteUser :execrows
DELETE FROM users WHERE id = $id;

-- name: DeleteDocument :execrows
UPDATE documents
SET
    deleted = 1
WHERE id = $id;

-- name: GetDeletedDocuments :many
SELECT documents.id
FROM documents
WHERE
    documents.deleted = true
    AND documents.id IN (sqlc.slice('document_ids'));

-- name: GetDocument :one
SELECT * FROM documents
WHERE id = $document_id LIMIT 1;

-- name: ListOPDSDocuments :many
SELECT docs.id, docs.title, docs.author, docs.description, docs.filepath
FROM documents AS docs
LEFT JOIN document_user_statistics AS dus
    ON dus.document_id = docs.id AND dus.user_id = $user_id
WHERE docs.deleted = false
    AND (docs.title LIKE sqlc.narg('query') OR docs.author LIKE $query OR $query IS NULL)
ORDER BY dus.last_read DESC, docs.created_at DESC
LIMIT $limit
OFFSET $offset;

-- name: GetLastActivity :one
SELECT start_time
FROM activity
WHERE device_id = $device_id
AND user_id = $user_id
ORDER BY start_time DESC LIMIT 1;

-- name: GetMissingDocuments :many
SELECT documents.* FROM documents
WHERE
    documents.filepath IS NOT NULL
    AND documents.deleted = false
    AND documents.id NOT IN (sqlc.slice('document_ids'));

-- name: GetUser :one
SELECT * FROM users
WHERE id = $user_id LIMIT 1;

-- name: GetWantedDocuments :many
SELECT
    CAST(value AS TEXT) AS id,
    CAST((documents.filepath IS NULL) AS BOOLEAN) AS want_file,
    CAST((documents.id IS NULL) AS BOOLEAN) AS want_metadata
FROM json_each(CAST(sqlc.arg(document_ids) AS TEXT))
LEFT JOIN documents
ON value = documents.id
WHERE (
    documents.id IS NOT NULL
    AND documents.deleted = false
    AND documents.filepath IS NULL
)
OR (documents.id IS NULL);

-- name: UpdateProgress :one
INSERT OR REPLACE INTO document_progress (
    user_id,
    document_id,
    device_id,
    percentage,
    progress
)
VALUES (?, ?, ?, ?, ?)
RETURNING *;

-- name: UpdateSettings :one
INSERT INTO settings (name, value)
VALUES (?, ?)
ON CONFLICT(name) DO UPDATE SET value = excluded.value
RETURNING *;

-- name: UpsertDocument :one
INSERT INTO documents (
    id,
    md5,
    storage_root_id,
    filepath,
    coverfile,
    title,
    author,
    series,
    series_index,
    lang,
    description,
    words,
    isbn10,
    isbn13
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT DO UPDATE
SET
    md5 =           COALESCE(excluded.md5, md5),
    storage_root_id = COALESCE(excluded.storage_root_id, storage_root_id),
    filepath =      COALESCE(excluded.filepath, filepath),
    coverfile =     COALESCE(excluded.coverfile, coverfile),
    title =         COALESCE(excluded.title, title),
    author =        COALESCE(excluded.author, author),
    series =        COALESCE(excluded.series, series),
    series_index =  COALESCE(excluded.series_index, series_index),
    lang =          COALESCE(excluded.lang, lang),
    description =   COALESCE(excluded.description, description),
    words =         COALESCE(excluded.words, words),
    isbn10 =        COALESCE(excluded.isbn10, isbn10),
    isbn13 =        COALESCE(excluded.isbn13, isbn13)
RETURNING *;
