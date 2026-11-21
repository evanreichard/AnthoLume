-- name: CountWebDocuments :one
SELECT count(*)
FROM documents AS d
WHERE d.deleted = 0
    AND (CAST(sqlc.arg(search) AS TEXT) = ''
        OR instr(lower(coalesce(d.title, '')), lower(sqlc.arg(search))) > 0
        OR instr(lower(coalesce(d.author, '')), lower(sqlc.arg(search))) > 0)
    AND (NOT CAST(sqlc.arg(resumable) AS BOOLEAN)
        OR (NULLIF(d.filepath, '') IS NOT NULL AND EXISTS (
            SELECT 1
            FROM reading_heads AS h
            WHERE h.user_id = sqlc.arg(user_id) AND h.document_id = d.id
                AND NULLIF(h.position, '') IS NOT NULL
        )));

-- name: ListWebDocuments :many
WITH selection AS (
    SELECT d.id, d.title, d.author, CAST(sqlc.arg(sort_by) AS TEXT) AS sort_by,
        strftime('%Y-%m-%dT%H:%M:%fZ', d.created_at) AS added_at,
        strftime('%Y-%m-%dT%H:%M:%fZ', NULLIF(MAX(
            COALESCE((
                SELECT MAX(julianday(a.start_time))
                FROM activity AS a
                WHERE a.user_id = sqlc.arg(user_id) AND a.document_id = d.id
                    AND a.duration > 0 AND julianday(a.start_time) <= julianday('now')
            ), 0),
            COALESCE((
                SELECT julianday(h.updated_at)
                FROM reading_heads AS h
                WHERE h.user_id = sqlc.arg(user_id) AND h.document_id = d.id
                    AND h.position IS NOT NULL
            ), 0)
        ), 0)) AS last_read_at,
        (
            SELECT h.fraction
            FROM reading_heads AS h
            WHERE h.user_id = sqlc.arg(user_id) AND h.document_id = d.id
                AND NULLIF(h.position, '') IS NOT NULL AND h.fraction BETWEEN 0 AND 1
        ) AS resume_fraction
    FROM documents AS d
    WHERE d.deleted = 0
        AND (CAST(sqlc.arg(search) AS TEXT) = ''
            OR instr(lower(coalesce(d.title, '')), lower(sqlc.arg(search))) > 0
            OR instr(lower(coalesce(d.author, '')), lower(sqlc.arg(search))) > 0)
        AND (NOT CAST(sqlc.arg(resumable) AS BOOLEAN)
            OR (NULLIF(d.filepath, '') IS NOT NULL AND EXISTS (
                SELECT 1
                FROM reading_heads AS h
                WHERE h.user_id = sqlc.arg(user_id) AND h.document_id = d.id
                    AND NULLIF(h.position, '') IS NOT NULL
            )))
)
SELECT sqlc.embed(d), r.path AS root_path,
    CAST(COALESCE(added_at, '') AS TEXT) AS added_at,
    CAST(COALESCE(last_read_at, '') AS TEXT) AS last_read_at,
    resume_fraction
FROM selection
JOIN documents d ON d.id = selection.id
LEFT JOIN storage_roots r ON r.id = COALESCE(d.storage_root_id, 'library')
ORDER BY
    CASE WHEN sort_by = 'author' THEN NULLIF(trim(d.author), '') END COLLATE NOCASE ASC NULLS LAST,
    CASE WHEN sort_by = 'added' THEN selection.added_at END DESC NULLS LAST,
    CASE WHEN sort_by = 'read' THEN selection.last_read_at END DESC NULLS LAST,
    CASE WHEN sort_by IN ('title', 'author', 'added', 'read') THEN NULLIF(trim(d.title), '') END COLLATE NOCASE ASC NULLS LAST,
    d.id ASC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: GetWebDocumentReadingStats :one
SELECT total_time_seconds, CAST(total_wpm AS INTEGER) AS words_per_minute
FROM document_user_statistics
WHERE document_id = sqlc.arg(document_id) AND user_id = sqlc.arg(user_id);

-- name: ListWebInsightDays :many
SELECT CAST(LOCAL_DATE(start_time, CAST(sqlc.arg(timezone) AS TEXT)) AS TEXT) AS day,
    -- Give sqlc an integer scan target without casting a non-integer sum to an integer.
    SUM(duration) + 0 AS seconds
FROM activity
WHERE user_id = sqlc.arg(user_id)
    AND julianday(start_time) <= julianday(CAST(sqlc.arg(as_of) AS TEXT))
    AND duration > 0
GROUP BY 1
ORDER BY 1 DESC;

-- name: ListWebInsightActivity :many
SELECT CAST(a.id AS TEXT) AS id, a.document_id,
    CAST(COALESCE(NULLIF(d.title, ''), 'Untitled book') AS TEXT) AS title,
    CAST(COALESCE(d.deleted = 0, 0) AS BOOLEAN) AS available,
    a.start_time, a.duration, a.start_percentage, a.end_percentage
FROM activity AS a
LEFT JOIN documents AS d ON d.id = a.document_id
WHERE a.user_id = sqlc.arg(user_id)
    AND julianday(a.start_time) <= julianday(CAST(sqlc.arg(as_of) AS TEXT))
    AND a.duration > 0
    AND (CAST(sqlc.narg(document_id) AS TEXT) IS NULL OR a.document_id = sqlc.narg(document_id))
    AND (CAST(sqlc.narg(day_start) AS TEXT) IS NULL
        OR (a.start_time >= sqlc.narg(day_start) AND a.start_time < CAST(sqlc.narg(day_end) AS TEXT)))
    AND (CAST(sqlc.arg(cursor_id) AS TEXT) = ''
        OR (julianday(a.start_time), a.id) < (julianday(CAST(sqlc.arg(cursor_time) AS TEXT)), sqlc.arg(cursor_id)))
ORDER BY julianday(a.start_time) DESC, a.id DESC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: ListWebInsightProgress :many
SELECT h.document_id,
    CAST(COALESCE(NULLIF(d.title, ''), 'Untitled book') AS TEXT) AS title,
    CAST(COALESCE(d.deleted = 0, 0) AS BOOLEAN) AS available,
    CAST(h.updated_at AS TEXT) AS updated_at, h.fraction
FROM reading_heads AS h
LEFT JOIN documents AS d ON d.id = h.document_id
WHERE h.user_id = sqlc.arg(user_id)
    AND h.position IS NOT NULL AND h.updated_at IS NOT NULL
    AND (CAST(sqlc.arg(cursor_id) AS TEXT) = ''
        OR julianday(h.updated_at) < julianday(CAST(sqlc.arg(cursor_time) AS TEXT))
        OR (julianday(h.updated_at) = julianday(CAST(sqlc.arg(cursor_time) AS TEXT)) AND h.document_id > sqlc.arg(cursor_id)))
ORDER BY julianday(h.updated_at) DESC, h.document_id ASC
LIMIT sqlc.arg(page_size) OFFSET sqlc.arg(page_offset);

-- name: ListWebInsightRankings :many
WITH totals AS (
    SELECT a.user_id, SUM(a.duration) AS seconds,
        SUM(MAX(0, COALESCE(d.words, 0) * (a.end_percentage - a.start_percentage))) AS words
    FROM activity AS a
    JOIN users AS u ON u.id = a.user_id
    LEFT JOIN documents AS d ON d.id = a.document_id
    WHERE julianday(a.start_time) >= julianday(CAST(sqlc.arg(period_start) AS TEXT))
        AND julianday(a.start_time) <= julianday(CAST(sqlc.arg(as_of) AS TEXT))
        AND a.duration > 0
    GROUP BY a.user_id
), ranked AS (
    SELECT user_id, CASE CAST(sqlc.arg(metric) AS TEXT)
        WHEN 'words' THEN words
        WHEN 'pace' THEN words * 60.0 / seconds
        ELSE seconds
    END AS score
    FROM totals
)
SELECT user_id, CAST(score AS INTEGER) AS value
FROM ranked
WHERE score >= 1
ORDER BY value DESC, user_id ASC
LIMIT 20;

-- name: UpdateWebDocumentMetadata :execrows
UPDATE documents
SET title = CAST(sqlc.arg(title) AS TEXT),
    author = NULLIF(CAST(sqlc.arg(author) AS TEXT), ''),
    description = NULLIF(CAST(sqlc.arg(description) AS TEXT), ''),
    isbn10 = NULLIF(CAST(sqlc.arg(isbn10) AS TEXT), ''),
    isbn13 = NULLIF(CAST(sqlc.arg(isbn13) AS TEXT), ''),
    coverfile = COALESCE(sqlc.narg(coverfile), coverfile)
WHERE id = sqlc.arg(id) AND deleted = 0;
