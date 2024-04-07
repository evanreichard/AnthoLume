-- name: AddActivity :one
INSERT INTO activity (
    user_id,
    document_id,
    device_id,
    start_time,
    duration,
    start_percentage,
    end_percentage
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
INSERT INTO users (id, pass, auth_hash, admin)
VALUES (?, ?, ?, ?)
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
        device_id,
        user_id,
        start_time,
        duration,
        ROUND(CAST(start_percentage AS REAL) * 100, 2) AS start_percentage,
        ROUND(CAST(end_percentage AS REAL) * 100, 2) AS end_percentage,
        ROUND(CAST(end_percentage - start_percentage AS REAL) * 100, 2) AS read_percentage
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
    device_id,
    CAST(STRFTIME('%Y-%m-%d %H:%M:%S', LOCAL_TIME(activity.start_time, users.timezone)) AS TEXT) AS start_time,
    title,
    author,
    duration,
    start_percentage,
    end_percentage,
    read_percentage
FROM filtered_activity AS activity
LEFT JOIN documents ON documents.id = activity.document_id
LEFT JOIN users ON users.id = activity.user_id;

-- name: GetDailyReadStats :many
WITH RECURSIVE last_30_days AS (
    SELECT DATE(LOCAL_TIME(STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'), timezone)) AS date
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
        DATE(LOCAL_TIME(start_time, timezone)) AS day
    FROM filtered_activity AS activity
    LEFT JOIN users ON users.id = activity.user_id
    GROUP BY day
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
    devices.id,
    devices.device_name,
    CAST(STRFTIME('%Y-%m-%d %H:%M:%S', LOCAL_TIME(devices.created_at, users.timezone)) AS TEXT) AS created_at,
    CAST(STRFTIME('%Y-%m-%d %H:%M:%S', LOCAL_TIME(devices.last_synced, users.timezone)) AS TEXT) AS last_synced
FROM devices
JOIN users ON users.id = devices.user_id
WHERE users.id = $user_id
ORDER BY devices.last_synced DESC;

-- name: GetDocument :one
SELECT * FROM documents
WHERE id = $document_id LIMIT 1;

-- name: GetDocumentProgress :one
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

    CAST(COALESCE(dus.total_wpm, 0.0) AS INTEGER) AS wpm,
    COALESCE(dus.read_percentage, 0) AS read_percentage,
    COALESCE(dus.total_time_seconds, 0) AS total_time_seconds,
    STRFTIME('%Y-%m-%d %H:%M:%S', LOCAL_TIME(COALESCE(dus.last_read, STRFTIME('%Y-%m-%dT%H:%M:%SZ', 0, 'unixepoch')), users.timezone))
        AS last_read,
    ROUND(CAST(CASE
        WHEN dus.percentage IS NULL THEN 0.0
        WHEN (dus.percentage * 100.0) > 97.0 THEN 100.0
        ELSE dus.percentage * 100.0
    END AS REAL), 2) AS percentage,
    CAST(CASE
        WHEN dus.total_time_seconds IS NULL THEN 0.0
        ELSE
            CAST(dus.total_time_seconds AS REAL)
            / (dus.read_percentage * 100.0)
    END AS INTEGER) AS seconds_per_percent
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

-- name: GetDocumentsSize :one
SELECT
    COUNT(rowid) AS length
FROM documents AS docs
WHERE $query IS NULL OR (
    docs.title LIKE $query OR
    docs.author LIKE $query
)
LIMIT 1;

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

    CAST(COALESCE(dus.total_wpm, 0.0) AS INTEGER) AS wpm,
    COALESCE(dus.read_percentage, 0) AS read_percentage,
    COALESCE(dus.total_time_seconds, 0) AS total_time_seconds,
    STRFTIME('%Y-%m-%d %H:%M:%S', LOCAL_TIME(COALESCE(dus.last_read, STRFTIME('%Y-%m-%dT%H:%M:%SZ', 0, 'unixepoch')), users.timezone))
        AS last_read,
    ROUND(CAST(CASE
        WHEN dus.percentage IS NULL THEN 0.0
        WHEN (dus.percentage * 100.0) > 97.0 THEN 100.0
        ELSE dus.percentage * 100.0
    END AS REAL), 2) AS percentage,

    CASE
        WHEN dus.total_time_seconds IS NULL THEN 0.0
        ELSE
            ROUND(
                CAST(dus.total_time_seconds AS REAL)
                / (dus.read_percentage * 100.0)
            )
    END AS seconds_per_percent
FROM documents AS docs
LEFT JOIN users ON users.id = $user_id
LEFT JOIN
    document_user_statistics AS dus
    ON dus.document_id = docs.id AND dus.user_id = $user_id
WHERE
    docs.deleted = false AND (
        $query IS NULL OR (
            docs.title LIKE $query OR
            docs.author LIKE $query
        )
    )
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

-- name: GetProgress :many
SELECT
    documents.title,
    documents.author,
    devices.device_name,
    ROUND(CAST(progress.percentage AS REAL) * 100, 2) AS percentage,
    progress.document_id,
    progress.user_id,
    CAST(STRFTIME('%Y-%m-%d %H:%M:%S', LOCAL_TIME(progress.created_at, users.timezone)) AS TEXT) AS created_at
FROM document_progress AS progress
LEFT JOIN users ON progress.user_id = users.id
LEFT JOIN devices ON progress.device_id = devices.id
LEFT JOIN documents ON progress.document_id = documents.id
WHERE
    progress.user_id = $user_id
    AND (
        (
            CAST($doc_filter AS BOOLEAN) = TRUE
            AND document_id = $document_id
        ) OR $doc_filter = FALSE
    )
ORDER BY created_at DESC
LIMIT $limit
OFFSET $offset;

-- name: GetUser :one
SELECT * FROM users
WHERE id = $user_id LIMIT 1;

-- name: GetUserStreaks :many
SELECT * FROM user_streaks
WHERE user_id = $user_id;

-- name: GetUsers :many
SELECT * FROM users;

-- name: GetUserStatistics :many
SELECT
    user_id,

    CAST(SUM(total_words_read) AS INTEGER) AS total_words_read,
    CAST(SUM(total_time_seconds) AS INTEGER) AS total_seconds,
    ROUND(COALESCE(CAST(SUM(total_words_read) AS REAL) / (SUM(total_time_seconds) / 60.0), 0.0), 2)
        AS total_wpm,

    CAST(SUM(yearly_words_read) AS INTEGER) AS yearly_words_read,
    CAST(SUM(yearly_time_seconds) AS INTEGER) AS yearly_seconds,
    ROUND(COALESCE(CAST(SUM(yearly_words_read) AS REAL) / (SUM(yearly_time_seconds) / 60.0), 0.0), 2)
        AS yearly_wpm,

    CAST(SUM(monthly_words_read) AS INTEGER) AS monthly_words_read,
    CAST(SUM(monthly_time_seconds) AS INTEGER) AS monthly_seconds,
    ROUND(COALESCE(CAST(SUM(monthly_words_read) AS REAL) / (SUM(monthly_time_seconds) / 60.0), 0.0), 2)
        AS monthly_wpm,

    CAST(SUM(weekly_words_read) AS INTEGER) AS weekly_words_read,
    CAST(SUM(weekly_time_seconds) AS INTEGER) AS weekly_seconds,
    ROUND(COALESCE(CAST(SUM(weekly_words_read) AS REAL) / (SUM(weekly_time_seconds) / 60.0), 0.0), 2)
        AS weekly_wpm

FROM document_user_statistics
WHERE total_words_read > 0
GROUP BY user_id
ORDER BY total_wpm DESC;

-- name: GetWantedDocuments :many
SELECT
    CAST(value AS TEXT) AS id,
    CAST((documents.filepath IS NULL) AS BOOLEAN) AS want_file,
    CAST((documents.id IS NULL) AS BOOLEAN) AS want_metadata
FROM json_each(?1)
LEFT JOIN documents
ON value = documents.id
WHERE (
    documents.id IS NOT NULL
    AND documents.deleted = false
    AND documents.filepath IS NULL
)
OR (documents.id IS NULL)
OR CAST($document_ids AS TEXT) != CAST($document_ids AS TEXT);

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
    auth_hash = COALESCE($auth_hash, auth_hash),
    timezone = COALESCE($timezone, timezone),
    admin = COALESCE($admin, admin)
WHERE id = $user_id
RETURNING *;

-- name: UpdateSettings :one
INSERT INTO settings (name, value)
VALUES (?, ?)
ON CONFLICT DO UPDATE
SET
    name = COALESCE(excluded.name, name),
    value = COALESCE(excluded.value, value)
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
