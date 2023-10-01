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

-- name: GetUser :one
SELECT * FROM users
WHERE id = $user_id LIMIT 1;

-- name: UpdateUser :one
UPDATE users
SET
    pass = COALESCE($password, pass),
    time_offset = COALESCE($time_offset, time_offset)
WHERE id = $user_id
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

-- name: DeleteDocument :execrows
UPDATE documents
SET
    deleted = 1
WHERE id = $id;

-- name: UpdateDocumentSync :one
UPDATE documents
SET
    synced = $synced
WHERE id = $id
RETURNING *;

-- name: UpdateDocumentDeleted :one
UPDATE documents
SET
  deleted = $deleted
WHERE id = $id
RETURNING *;

-- name: GetDocument :one
SELECT * FROM documents
WHERE id = $document_id LIMIT 1;

-- name: UpsertDevice :one
INSERT INTO devices (id, user_id, device_name)
VALUES (?, ?, ?)
ON CONFLICT DO UPDATE
SET
    device_name = COALESCE(excluded.device_name, device_name)
RETURNING *;

-- name: GetDevice :one
SELECT * FROM devices
WHERE id = $device_id LIMIT 1;

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

-- name: GetLastActivity :one
SELECT start_time
FROM activity
WHERE device_id = $device_id
AND user_id = $user_id
ORDER BY start_time DESC LIMIT 1;

-- name: AddActivity :one
INSERT INTO activity (
    user_id,
    document_id,
    device_id,
    start_time,
    duration,
    current_page,
    total_pages
)
VALUES (?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetMissingDocuments :many
SELECT documents.* FROM documents
WHERE
    documents.filepath IS NOT NULL
    AND documents.deleted = false
    AND documents.id NOT IN (sqlc.slice('document_ids'));

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

-- name: GetDeletedDocuments :many
SELECT documents.id
FROM documents
WHERE
    documents.deleted = true
    AND documents.id IN (sqlc.slice('document_ids'));

-- name: GetDocuments :many
SELECT * FROM documents
ORDER BY created_at DESC
LIMIT $limit
OFFSET $offset;

-- name: GetDocumentWithStats :one
WITH true_progress AS (
    SELECT
        start_time AS last_read,
        SUM(duration) AS total_time_seconds,
        document_id,
        current_page,
        total_pages,

	-- Determine Read Pages
	COUNT(DISTINCT current_page) AS read_pages,

	-- Derive Percentage of Book
        ROUND(CAST(current_page AS REAL) / CAST(total_pages AS REAL) * 100, 2) AS percentage
    FROM activity
    WHERE user_id = $user_id
    AND document_id = $document_id
    GROUP BY document_id
    HAVING MAX(start_time)
    LIMIT 1
)
SELECT
    documents.*,

    CAST(IFNULL(current_page, 0) AS INTEGER) AS current_page,
    CAST(IFNULL(total_pages, 0) AS INTEGER) AS total_pages,
    CAST(IFNULL(total_time_seconds, 0) AS INTEGER) AS total_time_seconds,
    CAST(DATETIME(IFNULL(last_read, "1970-01-01"), time_offset) AS TEXT) AS last_read,
    CAST(IFNULL(read_pages, 0) AS INTEGER) AS read_pages,

    -- Calculate Seconds / Page
    --   1. Calculate Total Time in Seconds (Sum Duration in Activity)
    --   2. Divide by Read Pages (Distinct Pages in Activity)
    CAST(CASE
	WHEN total_time_seconds IS NULL THEN 0.0
	ELSE ROUND(CAST(total_time_seconds AS REAL) / CAST(read_pages AS REAL))
    END AS INTEGER) AS seconds_per_page,

    -- Arbitrarily >97% is Complete
    CAST(CASE
	WHEN percentage > 97.0 THEN 100.0
	WHEN percentage IS NULL THEN 0.0
	ELSE percentage
    END AS REAL) AS percentage

FROM documents
LEFT JOIN true_progress ON true_progress.document_id = documents.id
LEFT JOIN users ON users.id = $user_id
WHERE documents.id = $document_id
ORDER BY true_progress.last_read DESC, documents.created_at DESC
LIMIT 1;

-- name: GetDocumentsWithStats :many
WITH true_progress AS (
    SELECT
        start_time AS last_read,
        SUM(duration) AS total_time_seconds,
        document_id,
        current_page,
        total_pages,
        ROUND(CAST(current_page AS REAL) / CAST(total_pages AS REAL) * 100, 2) AS percentage
    FROM activity
    WHERE user_id = $user_id
    GROUP BY document_id
    HAVING MAX(start_time)
)
SELECT
    documents.*,

    CAST(IFNULL(current_page, 0) AS INTEGER) AS current_page,
    CAST(IFNULL(total_pages, 0) AS INTEGER) AS total_pages,
    CAST(IFNULL(total_time_seconds, 0) AS INTEGER) AS total_time_seconds,
    CAST(DATETIME(IFNULL(last_read, "1970-01-01"), time_offset) AS TEXT) AS last_read,

    CAST(CASE
        WHEN percentage > 97.0 THEN 100.0
        WHEN percentage IS NULL THEN 0.0
        ELSE percentage
    END AS REAL) AS percentage

FROM documents
LEFT JOIN true_progress ON true_progress.document_id = documents.id
LEFT JOIN users ON users.id = $user_id
WHERE documents.deleted == false
ORDER BY true_progress.last_read DESC, documents.created_at DESC
LIMIT $limit
OFFSET $offset;

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

-- name: GetActivity :many
SELECT
    document_id,
    CAST(DATETIME(activity.start_time, time_offset) AS TEXT) AS start_time,
    title,
    author,
    duration,
    current_page,
    total_pages
FROM activity
LEFT JOIN documents ON documents.id = activity.document_id
LEFT JOIN users ON users.id = activity.user_id
WHERE
    activity.user_id = $user_id
    AND (
        CAST($doc_filter AS BOOLEAN) = TRUE
        AND document_id = $document_id
    )
    OR $doc_filter = FALSE
ORDER BY start_time DESC
LIMIT $limit
OFFSET $offset;

-- name: GetDevices :many
SELECT
    devices.device_name,
    CAST(DATETIME(devices.created_at, users.time_offset) AS TEXT) AS created_at,
    CAST(DATETIME(MAX(activity.created_at), users.time_offset) AS TEXT) AS last_sync
FROM activity
JOIN devices ON devices.id = activity.device_id
JOIN users ON users.id = $user_id
WHERE devices.user_id = $user_id
GROUP BY activity.device_id;

-- name: GetDocumentReadStats :one
SELECT
    count(DISTINCT page) AS pages_read,
    sum(duration) AS total_time
FROM rescaled_activity
WHERE document_id = $document_id
AND user_id = $user_id
AND start_time >= $start_time;

-- name: GetDocumentReadStatsCapped :one
WITH capped_stats AS (
    SELECT min(sum(duration), CAST($page_duration_cap AS INTEGER)) AS durations
    FROM rescaled_activity
    WHERE document_id = $document_id
    AND user_id = $user_id
    AND start_time >= $start_time
    GROUP BY page
)
SELECT
    CAST(count(*) AS INTEGER) AS pages_read,
    CAST(sum(durations) AS INTEGER) AS total_time
FROM capped_stats;

-- name: GetDocumentDaysRead :one
WITH document_days AS (
    SELECT DATE(start_time, time_offset) AS dates
    FROM rescaled_activity
    JOIN users ON users.id = rescaled_activity.user_id
    WHERE document_id = $document_id
    AND user_id = $user_id
    GROUP BY dates
)
SELECT CAST(count(*) AS INTEGER) AS days_read
FROM document_days;

-- name: GetUserWindowStreaks :one
WITH document_windows AS (
    SELECT
        CASE
          WHEN ?2 = "WEEK" THEN DATE(start_time, time_offset, 'weekday 0', '-7 day')
          WHEN ?2 = "DAY" THEN DATE(start_time, time_offset)
        END AS read_window,
        time_offset
    FROM activity
    JOIN users ON users.id = activity.user_id
    WHERE user_id = $user_id
    AND CAST($window AS TEXT) = CAST($window AS TEXT)
    GROUP BY read_window
),
partitions AS (
    SELECT
        document_windows.*,
        row_number() OVER (
            PARTITION BY 1 ORDER BY read_window DESC
        ) AS seqnum
    FROM document_windows
),
streaks AS (
    SELECT
        count(*) AS streak,
        MIN(read_window) AS start_date,
        MAX(read_window) AS end_date,
        time_offset
    FROM partitions
    GROUP BY
        CASE
            WHEN ?2 = "DAY" THEN DATE(read_window, '+' || seqnum || ' day')
            WHEN ?2 = "WEEK" THEN DATE(read_window, '+' || (seqnum * 7) || ' day')
        END,
        time_offset
    ORDER BY end_date DESC
),
max_streak AS (
    SELECT
        MAX(streak) AS max_streak,
        start_date AS max_streak_start_date,
        end_date AS max_streak_end_date
    FROM streaks
    LIMIT 1
),
current_streak AS (
    SELECT
        streak AS current_streak,
        start_date AS current_streak_start_date,
        end_date AS current_streak_end_date
    FROM streaks
    WHERE CASE
      WHEN ?2 = "WEEK" THEN
          DATE('now', time_offset, 'weekday 0', '-14 day') = current_streak_end_date
          OR DATE('now', time_offset, 'weekday 0', '-7 day') = current_streak_end_date
      WHEN ?2 = "DAY" THEN
          DATE('now', time_offset, '-1 day') = current_streak_end_date
          OR DATE('now', time_offset) = current_streak_end_date
    END
    LIMIT 1
)
SELECT
    CAST(IFNULL(max_streak, 0) AS INTEGER) AS max_streak,
    CAST(IFNULL(max_streak_start_date, "N/A") AS TEXT) AS max_streak_start_date,
    CAST(IFNULL(max_streak_end_date, "N/A") AS TEXT) AS max_streak_end_date,
    IFNULL(current_streak, 0) AS current_streak,
    CAST(IFNULL(current_streak_start_date, "N/A") AS TEXT) AS current_streak_start_date,
    CAST(IFNULL(current_streak_end_date, "N/A") AS TEXT) AS current_streak_end_date
FROM max_streak
LEFT JOIN current_streak ON 1 = 1
LIMIT 1;

-- name: GetDatabaseInfo :one
SELECT
    (SELECT count(rowid) FROM activity WHERE activity.user_id = $user_id) AS activity_size,
    (SELECT count(rowid) FROM documents) AS documents_size,
    (SELECT count(rowid) FROM document_progress WHERE document_progress.user_id = $user_id) AS progress_size,
    (SELECT count(rowid) FROM devices WHERE devices.user_id = $user_id) AS devices_size
LIMIT 1;

-- name: GetDailyReadStats :many
WITH RECURSIVE last_30_days AS (
    SELECT DATE('now', time_offset) AS date
    FROM users WHERE users.id = $user_id
    UNION ALL
    SELECT DATE(date, '-1 days')
    FROM last_30_days
    LIMIT 30
),
activity_records AS (
    SELECT
        sum(duration) AS seconds_read,
        DATE(start_time, time_offset) AS day
    FROM activity
    LEFT JOIN users ON users.id = activity.user_id
    WHERE user_id = $user_id
    AND start_time > DATE('now', '-31 days')
    GROUP BY day
    ORDER BY day DESC
    LIMIT 30
)
SELECT
    CAST(date AS TEXT),
    CAST(CASE
      WHEN seconds_read IS NULL THEN 0
      ELSE seconds_read / 60
    END AS INTEGER) AS minutes_read
FROM last_30_days
LEFT JOIN activity_records ON activity_records.day == last_30_days.date
ORDER BY date DESC
LIMIT 30;
