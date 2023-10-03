-- name: AddActivity :one
INSERT INTO raw_activity (
    user_id,
    document_id,
    device_id,
    start_time,
    duration,
    page,
    pages
)
VALUES (?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: AddMetadata :one
INSERT INTO metadata (
    document_id,
    title,
    author,
    description,
    gbid,
    olid,
    isbn10,
    isbn13
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: CreateUser :execrows
INSERT INTO users (id, pass)
VALUES (?, ?)
ON CONFLICT DO NOTHING;

-- name: DeleteDocument :execrows
UPDATE documents
SET
    deleted = 1
WHERE id = $id;

-- name: GetActivity :many
WITH filtered_activity AS (
    SELECT
        document_id,
        user_id,
        start_time,
        duration,
        page,
        pages
    FROM activity
    WHERE
        activity.user_id = $user_id
        AND (
            (
                CAST($doc_filter AS BOOLEAN) = TRUE
                AND document_id = $document_id
            ) OR $doc_filter = FALSE
        )
    ORDER BY start_time DESC
    LIMIT $limit
    OFFSET $offset
)

SELECT
    document_id,
    CAST(DATETIME(activity.start_time, users.time_offset) AS TEXT) AS start_time,
    title,
    author,
    duration,
    page,
    pages
FROM filtered_activity AS activity
LEFT JOIN documents ON documents.id = activity.document_id
LEFT JOIN users ON users.id = activity.user_id;

-- name: GetDailyReadStats :many
WITH RECURSIVE last_30_days AS (
    SELECT DATE('now', time_offset) AS date
    FROM users WHERE users.id = $user_id
    UNION ALL
    SELECT DATE(date, '-1 days')
    FROM last_30_days
    LIMIT 30
),
filtered_activity AS (
    SELECT
	user_id,
        start_time,
	duration
    FROM activity
    WHERE start_time > DATE('now', '-31 days')
    AND activity.user_id = $user_id
),
activity_days AS (
    SELECT
        SUM(duration) AS seconds_read,
        DATE(start_time, time_offset) AS day
    FROM filtered_activity AS activity
    LEFT JOIN users ON users.id = activity.user_id
    GROUP BY day
    LIMIT 30
)
SELECT
    CAST(date AS TEXT),
    CAST(CASE
      WHEN seconds_read IS NULL THEN 0
      ELSE seconds_read / 60
    END AS INTEGER) AS minutes_read
FROM last_30_days
LEFT JOIN activity_days ON activity_days.day == last_30_days.date
ORDER BY date DESC
LIMIT 30;

-- name: GetDatabaseInfo :one
SELECT
    (SELECT COUNT(rowid) FROM activity WHERE activity.user_id = $user_id) AS activity_size,
    (SELECT COUNT(rowid) FROM documents) AS documents_size,
    (SELECT COUNT(rowid) FROM document_progress WHERE document_progress.user_id = $user_id) AS progress_size,
    (SELECT COUNT(rowid) FROM devices WHERE devices.user_id = $user_id) AS devices_size
LIMIT 1;

-- name: GetDeletedDocuments :many
SELECT documents.id
FROM documents
WHERE
    documents.deleted = true
    AND documents.id IN (sqlc.slice('document_ids'));

-- name: GetDevice :one
SELECT * FROM devices
WHERE id = $device_id LIMIT 1;

-- name: GetDevices :many
SELECT
    devices.device_name,
    CAST(DATETIME(devices.created_at, users.time_offset) AS TEXT) AS created_at,
    CAST(DATETIME(devices.last_synced, users.time_offset) AS TEXT) AS last_synced
FROM devices
JOIN users ON users.id = devices.user_id
WHERE users.id = $user_id;

-- name: GetDocument :one
SELECT * FROM documents
WHERE id = $document_id LIMIT 1;

-- name: GetDocumentDaysRead :one
WITH document_days AS (
    SELECT DATE(start_time, time_offset) AS dates
    FROM activity
    JOIN users ON users.id = activity.user_id
    WHERE document_id = $document_id
    AND user_id = $user_id
    GROUP BY dates
)
SELECT CAST(COUNT(*) AS INTEGER) AS days_read
FROM document_days;

-- name: GetDocumentReadStats :one
SELECT
    COUNT(DISTINCT page) AS pages_read,
    SUM(duration) AS total_time
FROM activity
WHERE document_id = $document_id
AND user_id = $user_id
AND start_time >= $start_time;

-- name: GetDocumentReadStatsCapped :one
WITH capped_stats AS (
    SELECT MIN(SUM(duration), CAST($page_duration_cap AS INTEGER)) AS durations
    FROM activity
    WHERE document_id = $document_id
    AND user_id = $user_id
    AND start_time >= $start_time
    GROUP BY page
)
SELECT
    CAST(COUNT(*) AS INTEGER) AS pages_read,
    CAST(SUM(durations) AS INTEGER) AS total_time
FROM capped_stats;

-- name: GetDocumentWithStats :one
SELECT
    docs.id,
    docs.title,
    docs.author,
    docs.description,
    docs.isbn10,
    docs.isbn13,
    docs.filepath,
    docs.words,

    CAST(COALESCE(dus.wpm, 0.0) AS INTEGER) AS wpm,
    COALESCE(dus.page, 0) AS page,
    COALESCE(dus.pages, 0) AS pages,
    COALESCE(dus.read_pages, 0) AS read_pages,
    COALESCE(dus.total_time_seconds, 0) AS total_time_seconds,
    DATETIME(COALESCE(dus.last_read, "1970-01-01"), users.time_offset)
        AS last_read,
    CASE
        WHEN dus.percentage > 97.0 THEN 100.0
        WHEN dus.percentage IS NULL THEN 0.0
        ELSE dus.percentage
    END AS percentage,
    CAST(CASE
        WHEN dus.total_time_seconds IS NULL THEN 0.0
        ELSE
	    CAST(dus.total_time_seconds AS REAL)
	    / CAST(dus.read_pages AS REAL)
    END AS INTEGER) AS seconds_per_page
FROM documents AS docs
LEFT JOIN users ON users.id = $user_id
LEFT JOIN
    document_user_statistics AS dus
    ON dus.document_id = docs.id AND dus.user_id = $user_id
WHERE users.id = $user_id
AND docs.id = $document_id
LIMIT 1;

-- name: GetDocuments :many
SELECT * FROM documents
ORDER BY created_at DESC
LIMIT $limit
OFFSET $offset;

-- name: GetDocumentsWithStats :many
SELECT
    docs.id,
    docs.title,
    docs.author,
    docs.description,
    docs.isbn10,
    docs.isbn13,
    docs.filepath,
    docs.words,

    CAST(COALESCE(dus.wpm, 0.0) AS INTEGER) AS wpm,
    COALESCE(dus.page, 0) AS page,
    COALESCE(dus.pages, 0) AS pages,
    COALESCE(dus.read_pages, 0) AS read_pages,
    COALESCE(dus.total_time_seconds, 0) AS total_time_seconds,
    DATETIME(COALESCE(dus.last_read, "1970-01-01"), users.time_offset)
        AS last_read,
    CASE
        WHEN dus.percentage > 97.0 THEN 100.0
        WHEN dus.percentage IS NULL THEN 0.0
        ELSE dus.percentage
    END AS percentage,
    CASE
        WHEN dus.total_time_seconds IS NULL THEN 0.0
        ELSE
            ROUND(
                CAST(dus.total_time_seconds AS REAL)
                / CAST(dus.read_pages AS REAL)
            )
    END AS seconds_per_page
FROM documents AS docs
LEFT JOIN users ON users.id = $user_id
LEFT JOIN
    document_user_statistics AS dus
    ON dus.document_id = docs.id AND dus.user_id = $user_id
WHERE docs.deleted = false
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

-- name: GetProgress :one
SELECT
    document_progress.*,
    devices.device_name
FROM document_progress
JOIN devices ON document_progress.device_id = devices.id
WHERE
    document_progress.user_id = $user_id
    AND document_progress.document_id = $document_id
ORDER BY
    document_progress.created_at
    DESC
LIMIT 1;

-- name: GetUser :one
SELECT * FROM users
WHERE id = $user_id LIMIT 1;

-- name: GetUserStreaks :many
SELECT * FROM user_streaks
WHERE user_id = $user_id;

-- name: GetUsers :many
SELECT * FROM users
WHERE
    users.id = $user
    OR ?1 IN (
        SELECT id
        FROM users
        WHERE id = $user
        AND admin = 1
    )
ORDER BY created_at DESC
LIMIT $limit
OFFSET $offset;

-- name: GetWPMLeaderboard :many
SELECT
    user_id,
    CAST(SUM(words_read) AS INTEGER) AS total_words_read,
    CAST(SUM(total_time_seconds) AS INTEGER) AS total_seconds,
    ROUND(CAST(SUM(words_read) AS REAL) / (SUM(total_time_seconds) / 60.0), 2)
        AS wpm
FROM document_user_statistics
WHERE words_read > 0
GROUP BY user_id
ORDER BY wpm DESC;

-- name: GetWantedDocuments :many
SELECT
    CAST(value AS TEXT) AS id,
    CAST((documents.filepath IS NULL) AS BOOLEAN) AS want_file,
    CAST((IFNULL(documents.synced, false) != true) AS BOOLEAN) AS want_metadata
FROM json_each(?1)
LEFT JOIN documents
ON value = documents.id
WHERE (
    documents.id IS NOT NULL
    AND documents.deleted = false
    AND (
        documents.synced = false
        OR documents.filepath IS NULL
    )
)
OR (documents.id IS NULL)
OR CAST($document_ids AS TEXT) != CAST($document_ids AS TEXT);

-- name: UpdateDocumentDeleted :one
UPDATE documents
SET
  deleted = $deleted
WHERE id = $id
RETURNING *;

-- name: UpdateDocumentSync :one
UPDATE documents
SET
    synced = $synced
WHERE id = $id
RETURNING *;

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

-- name: UpdateUser :one
UPDATE users
SET
    pass = COALESCE($password, pass),
    time_offset = COALESCE($time_offset, time_offset)
WHERE id = $user_id
RETURNING *;

-- name: UpsertDevice :one
INSERT INTO devices (id, user_id, last_synced, device_name)
VALUES (?, ?, ?, ?)
ON CONFLICT DO UPDATE
SET
    device_name = COALESCE(excluded.device_name, device_name),
    last_synced = COALESCE(excluded.last_synced, last_synced)
RETURNING *;

-- name: UpsertDocument :one
INSERT INTO documents (
    id,
    md5,
    filepath,
    coverfile,
    title,
    author,
    series,
    series_index,
    lang,
    description,
    words,
    olid,
    gbid,
    isbn10,
    isbn13
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT DO UPDATE
SET
    md5 =           COALESCE(excluded.md5, md5),
    filepath =      COALESCE(excluded.filepath, filepath),
    coverfile =     COALESCE(excluded.coverfile, coverfile),
    title =         COALESCE(excluded.title, title),
    author =        COALESCE(excluded.author, author),
    series =        COALESCE(excluded.series, series),
    series_index =  COALESCE(excluded.series_index, series_index),
    lang =          COALESCE(excluded.lang, lang),
    description =   COALESCE(excluded.description, description),
    words =         COALESCE(excluded.words, words),
    olid =          COALESCE(excluded.olid, olid),
    gbid =          COALESCE(excluded.gbid, gbid),
    isbn10 =        COALESCE(excluded.isbn10, isbn10),
    isbn13 =        COALESCE(excluded.isbn13, isbn13)
RETURNING *;
