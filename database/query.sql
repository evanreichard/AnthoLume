-- name: CreateUser :execrows
INSERT INTO users (id, pass)
VALUES (?, ?)
ON CONFLICT DO NOTHING;

-- name: GetUser :one
SELECT * FROM users
WHERE id = $user_id LIMIT 1;

-- name: UpsertDocument :one
INSERT INTO documents (
    id,
    md5,
    filepath,
    title,
    author,
    series,
    series_index,
    lang,
    description,
    olid
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT DO UPDATE
SET
    md5 =           COALESCE(excluded.md5, md5),
    filepath =      COALESCE(excluded.filepath, filepath),
    title =         COALESCE(excluded.title, title),
    author =        COALESCE(excluded.author, author),
    series =        COALESCE(excluded.series, series),
    series_index =  COALESCE(excluded.series_index, series_index),
    lang =          COALESCE(excluded.lang, lang),
    description =   COALESCE(excluded.description, description),
    olid =          COALESCE(excluded.olid, olid)
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
SELECT CAST(value AS TEXT) AS id
FROM json_each(?1)
LEFT JOIN documents
ON value = documents.id
WHERE (
    documents.id IS NOT NULL
    AND documents.synced = false
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

-- name: GetDocumentsWithStats :many
WITH true_progress AS (
    SELECT
        start_time AS last_read,
        SUM(duration) / 60 AS total_time_minutes,
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
    CAST(IFNULL(total_time_minutes, 0) AS INTEGER) AS total_time_minutes,

    CAST(
        STRFTIME('%Y-%m-%dT%H:%M:%SZ', IFNULL(last_read, "1970-01-01")
    ) AS TEXT) AS last_read,

    CAST(CASE
        WHEN percentage > 97.0 THEN 100.0
        WHEN percentage IS NULL THEN 0.0
        ELSE percentage
    END AS REAL) AS percentage

FROM documents
LEFT JOIN true_progress ON document_id = id
ORDER BY last_read DESC, created_at DESC
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
SELECT * FROM activity
WHERE
    user_id = $user_id
    AND (
        ($doc_filter = TRUE AND document_id = $document_id)
        OR $doc_filter = FALSE
    )
ORDER BY start_time DESC
LIMIT $limit
OFFSET $offset;

-- name: GetDevices :many
SELECT * FROM devices
WHERE user_id = $user_id
ORDER BY created_at DESC
LIMIT $limit
OFFSET $offset;

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
    SELECT date(start_time, 'localtime') AS dates
    FROM rescaled_activity
    WHERE document_id = $document_id
    AND user_id = $user_id
    GROUP BY dates
)
SELECT CAST(count(*) AS INTEGER) AS days_read
FROM document_days;

-- name: GetUserDayStreaks :one
WITH document_days AS (
    SELECT date(start_time, 'localtime') AS read_day
    FROM activity
    WHERE user_id = $user_id
    GROUP BY read_day
    ORDER BY read_day DESC
),
partitions AS (
    SELECT
        document_days.*,
        row_number() OVER (
            PARTITION BY 1 ORDER BY read_day DESC
        ) AS seqnum
    FROM document_days
),
streaks AS (
    SELECT
        count(*) AS streak,
        MIN(read_day) AS start_date,
        MAX(read_day) AS end_date
    FROM partitions
    GROUP BY date(read_day, '+' || seqnum || ' day')
    ORDER BY end_date DESC
),
max_streak AS (
    SELECT
        MAX(streak) AS max_streak,
        start_date AS max_streak_start_date,
        end_date AS max_streak_end_date
    FROM streaks
)
SELECT
    CAST(max_streak AS INTEGER),
    CAST(max_streak_start_date AS TEXT),
    CAST(max_streak_end_date AS TEXT),
    streak AS current_streak,
    CAST(start_date AS TEXT) AS current_streak_start_date,
    CAST(end_date AS TEXT) AS current_streak_end_date
FROM max_streak, streaks LIMIT 1;

-- name: GetUserWeekStreaks :one
WITH document_weeks AS (
    SELECT STRFTIME('%Y-%m-%d', start_time, 'localtime', 'weekday 0', '-7 day') AS read_week
    FROM activity
    WHERE user_id = $user_id
    GROUP BY read_week
    ORDER BY read_week DESC
),
partitions AS (
    SELECT
        document_weeks.*,
        row_number() OVER (
            PARTITION BY 1 ORDER BY read_week DESC
        ) AS seqnum
    FROM document_weeks
),
streaks AS (
    SELECT
        count(*) AS streak,
        MIN(read_week) AS start_date,
        MAX(read_week) AS end_date
    FROM partitions
    GROUP BY date(read_week, '+' || (seqnum * 7) || ' day')
    ORDER BY end_date DESC
),
max_streak AS (
    SELECT
        MAX(streak) AS max_streak,
        start_date AS max_streak_start_date,
        end_date AS max_streak_end_date
    FROM streaks
)
SELECT
    CAST(max_streak AS INTEGER),
    CAST(max_streak_start_date AS TEXT),
    CAST(max_streak_end_date AS TEXT),
    streak AS current_streak,
    CAST(start_date AS TEXT) AS current_streak_start_date,
    CAST(end_date AS TEXT) AS current_streak_end_date
FROM max_streak, streaks LIMIT 1;

-- name: GetUserWindowStreaks :one
WITH document_windows AS (
    SELECT CASE
      WHEN ?2 = "WEEK" THEN STRFTIME('%Y-%m-%d', start_time, 'localtime', 'weekday 0', '-7 day')
      WHEN ?2 = "DAY" THEN date(start_time, 'localtime')
    END AS read_window
    FROM activity
    WHERE user_id = $user_id
    AND CAST($window AS TEXT) = CAST($window AS TEXT)
    GROUP BY read_window
    ORDER BY read_window DESC
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
        MAX(read_window) AS end_date
    FROM partitions
    GROUP BY CASE
	WHEN ?2 = "DAY" THEN date(read_window, '+' || seqnum || ' day')
	WHEN ?2 = "WEEK" THEN date(read_window, '+' || (seqnum * 7) || ' day')
    END
    ORDER BY end_date DESC
),
max_streak AS (
    SELECT
        MAX(streak) AS max_streak,
        start_date AS max_streak_start_date,
        end_date AS max_streak_end_date
    FROM streaks
)
SELECT
    CAST(max_streak AS INTEGER),
    CAST(max_streak_start_date AS TEXT),
    CAST(max_streak_end_date AS TEXT),
    streak AS current_streak,
    CAST(start_date AS TEXT) AS current_streak_start_date,
    CAST(end_date AS TEXT) AS current_streak_end_date
FROM max_streak, streaks LIMIT 1;

-- name: GetDatabaseInfo :one
SELECT
    (SELECT count(rowid) FROM activity WHERE activity.user_id = $user_id) AS activity_size,
    (SELECT count(rowid) FROM documents) AS documents_size,
    (SELECT count(rowid) FROM document_progress WHERE document_progress.user_id = $user_id) AS progress_size,
    (SELECT count(rowid) FROM devices WHERE devices.user_id = $user_id) AS devices_size
LIMIT 1;

-- name: GetDailyReadStats :many
WITH RECURSIVE last_30_days (date) AS (
    SELECT date('now') AS date
    UNION ALL
    SELECT date(date, '-1 days')
    FROM last_30_days
    LIMIT 30
),
activity_records AS (
    SELECT
        sum(duration) AS seconds_read,
        date(start_time, 'localtime') AS day
    FROM activity
    WHERE user_id = $user_id
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

-- SELECT
--     sum(duration) / 60 AS minutes_read,
--     date(start_time, 'localtime') AS day
-- FROM activity
-- GROUP BY day
-- ORDER BY day DESC
-- LIMIT 10;
