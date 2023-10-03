// Code generated by sqlc. DO NOT EDIT.
// versions:
//   sqlc v1.21.0
// source: query.sql

package database

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

const addActivity = `-- name: AddActivity :one
INSERT INTO activity (
    user_id,
    document_id,
    device_id,
    start_time,
    duration,
    page,
    pages
)
VALUES (?, ?, ?, ?, ?, ?, ?)
RETURNING id, user_id, document_id, device_id, start_time, duration, page, pages, created_at
`

type AddActivityParams struct {
	UserID     string    `json:"user_id"`
	DocumentID string    `json:"document_id"`
	DeviceID   string    `json:"device_id"`
	StartTime  time.Time `json:"start_time"`
	Duration   int64     `json:"duration"`
	Page       int64     `json:"page"`
	Pages      int64     `json:"pages"`
}

func (q *Queries) AddActivity(ctx context.Context, arg AddActivityParams) (Activity, error) {
	row := q.db.QueryRowContext(ctx, addActivity,
		arg.UserID,
		arg.DocumentID,
		arg.DeviceID,
		arg.StartTime,
		arg.Duration,
		arg.Page,
		arg.Pages,
	)
	var i Activity
	err := row.Scan(
		&i.ID,
		&i.UserID,
		&i.DocumentID,
		&i.DeviceID,
		&i.StartTime,
		&i.Duration,
		&i.Page,
		&i.Pages,
		&i.CreatedAt,
	)
	return i, err
}

const addMetadata = `-- name: AddMetadata :one
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
RETURNING id, document_id, title, author, description, gbid, olid, isbn10, isbn13, created_at
`

type AddMetadataParams struct {
	DocumentID  string  `json:"document_id"`
	Title       *string `json:"title"`
	Author      *string `json:"author"`
	Description *string `json:"description"`
	Gbid        *string `json:"gbid"`
	Olid        *string `json:"olid"`
	Isbn10      *string `json:"isbn10"`
	Isbn13      *string `json:"isbn13"`
}

func (q *Queries) AddMetadata(ctx context.Context, arg AddMetadataParams) (Metadatum, error) {
	row := q.db.QueryRowContext(ctx, addMetadata,
		arg.DocumentID,
		arg.Title,
		arg.Author,
		arg.Description,
		arg.Gbid,
		arg.Olid,
		arg.Isbn10,
		arg.Isbn13,
	)
	var i Metadatum
	err := row.Scan(
		&i.ID,
		&i.DocumentID,
		&i.Title,
		&i.Author,
		&i.Description,
		&i.Gbid,
		&i.Olid,
		&i.Isbn10,
		&i.Isbn13,
		&i.CreatedAt,
	)
	return i, err
}

const createUser = `-- name: CreateUser :execrows
INSERT INTO users (id, pass)
VALUES (?, ?)
ON CONFLICT DO NOTHING
`

type CreateUserParams struct {
	ID   string  `json:"id"`
	Pass *string `json:"-"`
}

func (q *Queries) CreateUser(ctx context.Context, arg CreateUserParams) (int64, error) {
	result, err := q.db.ExecContext(ctx, createUser, arg.ID, arg.Pass)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

const deleteDocument = `-- name: DeleteDocument :execrows
UPDATE documents
SET
    deleted = 1
WHERE id = ?1
`

func (q *Queries) DeleteDocument(ctx context.Context, id string) (int64, error) {
	result, err := q.db.ExecContext(ctx, deleteDocument, id)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

const getActivity = `-- name: GetActivity :many
SELECT
    document_id,
    CAST(DATETIME(activity.start_time, time_offset) AS TEXT) AS start_time,
    title,
    author,
    duration,
    page,
    pages
FROM activity
LEFT JOIN documents ON documents.id = activity.document_id
LEFT JOIN users ON users.id = activity.user_id
WHERE
    activity.user_id = ?1
    AND (
        CAST(?2 AS BOOLEAN) = TRUE
        AND document_id = ?3
    )
    OR ?2 = FALSE
ORDER BY start_time DESC
LIMIT ?5
OFFSET ?4
`

type GetActivityParams struct {
	UserID     string `json:"user_id"`
	DocFilter  bool   `json:"doc_filter"`
	DocumentID string `json:"document_id"`
	Offset     int64  `json:"offset"`
	Limit      int64  `json:"limit"`
}

type GetActivityRow struct {
	DocumentID string  `json:"document_id"`
	StartTime  string  `json:"start_time"`
	Title      *string `json:"title"`
	Author     *string `json:"author"`
	Duration   int64   `json:"duration"`
	Page       int64   `json:"page"`
	Pages      int64   `json:"pages"`
}

func (q *Queries) GetActivity(ctx context.Context, arg GetActivityParams) ([]GetActivityRow, error) {
	rows, err := q.db.QueryContext(ctx, getActivity,
		arg.UserID,
		arg.DocFilter,
		arg.DocumentID,
		arg.Offset,
		arg.Limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []GetActivityRow
	for rows.Next() {
		var i GetActivityRow
		if err := rows.Scan(
			&i.DocumentID,
			&i.StartTime,
			&i.Title,
			&i.Author,
			&i.Duration,
			&i.Page,
			&i.Pages,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const getDailyReadStats = `-- name: GetDailyReadStats :many
WITH RECURSIVE last_30_days AS (
    SELECT DATE('now', time_offset) AS date
    FROM users WHERE users.id = ?1
    UNION ALL
    SELECT DATE(date, '-1 days')
    FROM last_30_days
    LIMIT 30
),
activity_records AS (
    SELECT
        SUM(duration) AS seconds_read,
        DATE(start_time, time_offset) AS day
    FROM activity
    LEFT JOIN users ON users.id = activity.user_id
    WHERE user_id = ?1
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
LIMIT 30
`

type GetDailyReadStatsRow struct {
	Date        string `json:"date"`
	MinutesRead int64  `json:"minutes_read"`
}

func (q *Queries) GetDailyReadStats(ctx context.Context, userID string) ([]GetDailyReadStatsRow, error) {
	rows, err := q.db.QueryContext(ctx, getDailyReadStats, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []GetDailyReadStatsRow
	for rows.Next() {
		var i GetDailyReadStatsRow
		if err := rows.Scan(&i.Date, &i.MinutesRead); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const getDatabaseInfo = `-- name: GetDatabaseInfo :one
SELECT
    (SELECT COUNT(rowid) FROM activity WHERE activity.user_id = ?1) AS activity_size,
    (SELECT COUNT(rowid) FROM documents) AS documents_size,
    (SELECT COUNT(rowid) FROM document_progress WHERE document_progress.user_id = ?1) AS progress_size,
    (SELECT COUNT(rowid) FROM devices WHERE devices.user_id = ?1) AS devices_size
LIMIT 1
`

type GetDatabaseInfoRow struct {
	ActivitySize  int64 `json:"activity_size"`
	DocumentsSize int64 `json:"documents_size"`
	ProgressSize  int64 `json:"progress_size"`
	DevicesSize   int64 `json:"devices_size"`
}

func (q *Queries) GetDatabaseInfo(ctx context.Context, userID string) (GetDatabaseInfoRow, error) {
	row := q.db.QueryRowContext(ctx, getDatabaseInfo, userID)
	var i GetDatabaseInfoRow
	err := row.Scan(
		&i.ActivitySize,
		&i.DocumentsSize,
		&i.ProgressSize,
		&i.DevicesSize,
	)
	return i, err
}

const getDeletedDocuments = `-- name: GetDeletedDocuments :many
SELECT documents.id
FROM documents
WHERE
    documents.deleted = true
    AND documents.id IN (/*SLICE:document_ids*/?)
`

func (q *Queries) GetDeletedDocuments(ctx context.Context, documentIds []string) ([]string, error) {
	query := getDeletedDocuments
	var queryParams []interface{}
	if len(documentIds) > 0 {
		for _, v := range documentIds {
			queryParams = append(queryParams, v)
		}
		query = strings.Replace(query, "/*SLICE:document_ids*/?", strings.Repeat(",?", len(documentIds))[1:], 1)
	} else {
		query = strings.Replace(query, "/*SLICE:document_ids*/?", "NULL", 1)
	}
	rows, err := q.db.QueryContext(ctx, query, queryParams...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		items = append(items, id)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const getDevice = `-- name: GetDevice :one
SELECT id, user_id, device_name, created_at, sync FROM devices
WHERE id = ?1 LIMIT 1
`

func (q *Queries) GetDevice(ctx context.Context, deviceID string) (Device, error) {
	row := q.db.QueryRowContext(ctx, getDevice, deviceID)
	var i Device
	err := row.Scan(
		&i.ID,
		&i.UserID,
		&i.DeviceName,
		&i.CreatedAt,
		&i.Sync,
	)
	return i, err
}

const getDevices = `-- name: GetDevices :many
SELECT
    devices.device_name,
    CAST(DATETIME(devices.created_at, users.time_offset) AS TEXT) AS created_at,
    CAST(DATETIME(MAX(activity.created_at), users.time_offset) AS TEXT) AS last_sync
FROM activity
JOIN devices ON devices.id = activity.device_id
JOIN users ON users.id = ?1
WHERE devices.user_id = ?1
GROUP BY activity.device_id
`

type GetDevicesRow struct {
	DeviceName string `json:"device_name"`
	CreatedAt  string `json:"created_at"`
	LastSync   string `json:"last_sync"`
}

func (q *Queries) GetDevices(ctx context.Context, userID string) ([]GetDevicesRow, error) {
	rows, err := q.db.QueryContext(ctx, getDevices, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []GetDevicesRow
	for rows.Next() {
		var i GetDevicesRow
		if err := rows.Scan(&i.DeviceName, &i.CreatedAt, &i.LastSync); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const getDocument = `-- name: GetDocument :one
SELECT id, md5, filepath, coverfile, title, author, series, series_index, lang, description, words, gbid, olid, isbn10, isbn13, synced, deleted, updated_at, created_at FROM documents
WHERE id = ?1 LIMIT 1
`

func (q *Queries) GetDocument(ctx context.Context, documentID string) (Document, error) {
	row := q.db.QueryRowContext(ctx, getDocument, documentID)
	var i Document
	err := row.Scan(
		&i.ID,
		&i.Md5,
		&i.Filepath,
		&i.Coverfile,
		&i.Title,
		&i.Author,
		&i.Series,
		&i.SeriesIndex,
		&i.Lang,
		&i.Description,
		&i.Words,
		&i.Gbid,
		&i.Olid,
		&i.Isbn10,
		&i.Isbn13,
		&i.Synced,
		&i.Deleted,
		&i.UpdatedAt,
		&i.CreatedAt,
	)
	return i, err
}

const getDocumentDaysRead = `-- name: GetDocumentDaysRead :one
WITH document_days AS (
    SELECT DATE(start_time, time_offset) AS dates
    FROM activity
    JOIN users ON users.id = activity.user_id
    WHERE document_id = ?1
    AND user_id = ?2
    GROUP BY dates
)
SELECT CAST(COUNT(*) AS INTEGER) AS days_read
FROM document_days
`

type GetDocumentDaysReadParams struct {
	DocumentID string `json:"document_id"`
	UserID     string `json:"user_id"`
}

func (q *Queries) GetDocumentDaysRead(ctx context.Context, arg GetDocumentDaysReadParams) (int64, error) {
	row := q.db.QueryRowContext(ctx, getDocumentDaysRead, arg.DocumentID, arg.UserID)
	var days_read int64
	err := row.Scan(&days_read)
	return days_read, err
}

const getDocumentReadStats = `-- name: GetDocumentReadStats :one
SELECT
    COUNT(DISTINCT page) AS pages_read,
    SUM(duration) AS total_time
FROM rescaled_activity
WHERE document_id = ?1
AND user_id = ?2
AND start_time >= ?3
`

type GetDocumentReadStatsParams struct {
	DocumentID string    `json:"document_id"`
	UserID     string    `json:"user_id"`
	StartTime  time.Time `json:"start_time"`
}

type GetDocumentReadStatsRow struct {
	PagesRead int64           `json:"pages_read"`
	TotalTime sql.NullFloat64 `json:"total_time"`
}

func (q *Queries) GetDocumentReadStats(ctx context.Context, arg GetDocumentReadStatsParams) (GetDocumentReadStatsRow, error) {
	row := q.db.QueryRowContext(ctx, getDocumentReadStats, arg.DocumentID, arg.UserID, arg.StartTime)
	var i GetDocumentReadStatsRow
	err := row.Scan(&i.PagesRead, &i.TotalTime)
	return i, err
}

const getDocumentReadStatsCapped = `-- name: GetDocumentReadStatsCapped :one
WITH capped_stats AS (
    SELECT MIN(SUM(duration), CAST(?1 AS INTEGER)) AS durations
    FROM rescaled_activity
    WHERE document_id = ?2
    AND user_id = ?3
    AND start_time >= ?4
    GROUP BY page
)
SELECT
    CAST(COUNT(*) AS INTEGER) AS pages_read,
    CAST(SUM(durations) AS INTEGER) AS total_time
FROM capped_stats
`

type GetDocumentReadStatsCappedParams struct {
	PageDurationCap int64     `json:"page_duration_cap"`
	DocumentID      string    `json:"document_id"`
	UserID          string    `json:"user_id"`
	StartTime       time.Time `json:"start_time"`
}

type GetDocumentReadStatsCappedRow struct {
	PagesRead int64 `json:"pages_read"`
	TotalTime int64 `json:"total_time"`
}

func (q *Queries) GetDocumentReadStatsCapped(ctx context.Context, arg GetDocumentReadStatsCappedParams) (GetDocumentReadStatsCappedRow, error) {
	row := q.db.QueryRowContext(ctx, getDocumentReadStatsCapped,
		arg.PageDurationCap,
		arg.DocumentID,
		arg.UserID,
		arg.StartTime,
	)
	var i GetDocumentReadStatsCappedRow
	err := row.Scan(&i.PagesRead, &i.TotalTime)
	return i, err
}

const getDocumentWithStats = `-- name: GetDocumentWithStats :one
WITH true_progress AS (
    SELECT
        start_time AS last_read,
        SUM(duration) AS total_time_seconds,
        document_id,
        page,
        pages,

	-- Determine Read Pages
	COUNT(DISTINCT page) AS read_pages,

	-- Derive Percentage of Book
        ROUND(CAST(page AS REAL) / CAST(pages AS REAL) * 100, 2) AS percentage
    FROM rescaled_activity
    WHERE user_id = ?1
    AND document_id = ?2
    GROUP BY document_id
    HAVING MAX(start_time)
    LIMIT 1
)
SELECT
    documents.id, documents.md5, documents.filepath, documents.coverfile, documents.title, documents.author, documents.series, documents.series_index, documents.lang, documents.description, documents.words, documents.gbid, documents.olid, documents.isbn10, documents.isbn13, documents.synced, documents.deleted, documents.updated_at, documents.created_at,

    CAST(IFNULL(page, 0) AS INTEGER) AS page,
    CAST(IFNULL(pages, 0) AS INTEGER) AS pages,
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
LEFT JOIN users ON users.id = ?1
WHERE documents.id = ?2
ORDER BY true_progress.last_read DESC, documents.created_at DESC
LIMIT 1
`

type GetDocumentWithStatsParams struct {
	UserID     string `json:"user_id"`
	DocumentID string `json:"document_id"`
}

type GetDocumentWithStatsRow struct {
	ID               string    `json:"id"`
	Md5              *string   `json:"md5"`
	Filepath         *string   `json:"filepath"`
	Coverfile        *string   `json:"coverfile"`
	Title            *string   `json:"title"`
	Author           *string   `json:"author"`
	Series           *string   `json:"series"`
	SeriesIndex      *int64    `json:"series_index"`
	Lang             *string   `json:"lang"`
	Description      *string   `json:"description"`
	Words            *int64    `json:"words"`
	Gbid             *string   `json:"gbid"`
	Olid             *string   `json:"-"`
	Isbn10           *string   `json:"isbn10"`
	Isbn13           *string   `json:"isbn13"`
	Synced           bool      `json:"-"`
	Deleted          bool      `json:"-"`
	UpdatedAt        time.Time `json:"updated_at"`
	CreatedAt        time.Time `json:"created_at"`
	Page             int64     `json:"page"`
	Pages            int64     `json:"pages"`
	TotalTimeSeconds int64     `json:"total_time_seconds"`
	LastRead         string    `json:"last_read"`
	ReadPages        int64     `json:"read_pages"`
	SecondsPerPage   int64     `json:"seconds_per_page"`
	Percentage       float64   `json:"percentage"`
}

func (q *Queries) GetDocumentWithStats(ctx context.Context, arg GetDocumentWithStatsParams) (GetDocumentWithStatsRow, error) {
	row := q.db.QueryRowContext(ctx, getDocumentWithStats, arg.UserID, arg.DocumentID)
	var i GetDocumentWithStatsRow
	err := row.Scan(
		&i.ID,
		&i.Md5,
		&i.Filepath,
		&i.Coverfile,
		&i.Title,
		&i.Author,
		&i.Series,
		&i.SeriesIndex,
		&i.Lang,
		&i.Description,
		&i.Words,
		&i.Gbid,
		&i.Olid,
		&i.Isbn10,
		&i.Isbn13,
		&i.Synced,
		&i.Deleted,
		&i.UpdatedAt,
		&i.CreatedAt,
		&i.Page,
		&i.Pages,
		&i.TotalTimeSeconds,
		&i.LastRead,
		&i.ReadPages,
		&i.SecondsPerPage,
		&i.Percentage,
	)
	return i, err
}

const getDocuments = `-- name: GetDocuments :many
SELECT id, md5, filepath, coverfile, title, author, series, series_index, lang, description, words, gbid, olid, isbn10, isbn13, synced, deleted, updated_at, created_at FROM documents
ORDER BY created_at DESC
LIMIT ?2
OFFSET ?1
`

type GetDocumentsParams struct {
	Offset int64 `json:"offset"`
	Limit  int64 `json:"limit"`
}

func (q *Queries) GetDocuments(ctx context.Context, arg GetDocumentsParams) ([]Document, error) {
	rows, err := q.db.QueryContext(ctx, getDocuments, arg.Offset, arg.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Document
	for rows.Next() {
		var i Document
		if err := rows.Scan(
			&i.ID,
			&i.Md5,
			&i.Filepath,
			&i.Coverfile,
			&i.Title,
			&i.Author,
			&i.Series,
			&i.SeriesIndex,
			&i.Lang,
			&i.Description,
			&i.Words,
			&i.Gbid,
			&i.Olid,
			&i.Isbn10,
			&i.Isbn13,
			&i.Synced,
			&i.Deleted,
			&i.UpdatedAt,
			&i.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const getDocumentsWithStats = `-- name: GetDocumentsWithStats :many
WITH true_progress AS (
    SELECT
        start_time AS last_read,
        SUM(duration) AS total_time_seconds,
        document_id,
        page,
        pages,
        ROUND(CAST(page AS REAL) / CAST(pages AS REAL) * 100, 2) AS percentage
    FROM activity
    WHERE user_id = ?1
    GROUP BY document_id
    HAVING MAX(start_time)
)
SELECT
    documents.id, documents.md5, documents.filepath, documents.coverfile, documents.title, documents.author, documents.series, documents.series_index, documents.lang, documents.description, documents.words, documents.gbid, documents.olid, documents.isbn10, documents.isbn13, documents.synced, documents.deleted, documents.updated_at, documents.created_at,

    CAST(IFNULL(page, 0) AS INTEGER) AS page,
    CAST(IFNULL(pages, 0) AS INTEGER) AS pages,
    CAST(IFNULL(total_time_seconds, 0) AS INTEGER) AS total_time_seconds,
    CAST(DATETIME(IFNULL(last_read, "1970-01-01"), time_offset) AS TEXT) AS last_read,

    CAST(CASE
        WHEN percentage > 97.0 THEN 100.0
        WHEN percentage IS NULL THEN 0.0
        ELSE percentage
    END AS REAL) AS percentage

FROM documents
LEFT JOIN true_progress ON true_progress.document_id = documents.id
LEFT JOIN users ON users.id = ?1
WHERE documents.deleted == false
ORDER BY true_progress.last_read DESC, documents.created_at DESC
LIMIT ?3
OFFSET ?2
`

type GetDocumentsWithStatsParams struct {
	UserID string `json:"user_id"`
	Offset int64  `json:"offset"`
	Limit  int64  `json:"limit"`
}

type GetDocumentsWithStatsRow struct {
	ID               string    `json:"id"`
	Md5              *string   `json:"md5"`
	Filepath         *string   `json:"filepath"`
	Coverfile        *string   `json:"coverfile"`
	Title            *string   `json:"title"`
	Author           *string   `json:"author"`
	Series           *string   `json:"series"`
	SeriesIndex      *int64    `json:"series_index"`
	Lang             *string   `json:"lang"`
	Description      *string   `json:"description"`
	Words            *int64    `json:"words"`
	Gbid             *string   `json:"gbid"`
	Olid             *string   `json:"-"`
	Isbn10           *string   `json:"isbn10"`
	Isbn13           *string   `json:"isbn13"`
	Synced           bool      `json:"-"`
	Deleted          bool      `json:"-"`
	UpdatedAt        time.Time `json:"updated_at"`
	CreatedAt        time.Time `json:"created_at"`
	Page             int64     `json:"page"`
	Pages            int64     `json:"pages"`
	TotalTimeSeconds int64     `json:"total_time_seconds"`
	LastRead         string    `json:"last_read"`
	Percentage       float64   `json:"percentage"`
}

func (q *Queries) GetDocumentsWithStats(ctx context.Context, arg GetDocumentsWithStatsParams) ([]GetDocumentsWithStatsRow, error) {
	rows, err := q.db.QueryContext(ctx, getDocumentsWithStats, arg.UserID, arg.Offset, arg.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []GetDocumentsWithStatsRow
	for rows.Next() {
		var i GetDocumentsWithStatsRow
		if err := rows.Scan(
			&i.ID,
			&i.Md5,
			&i.Filepath,
			&i.Coverfile,
			&i.Title,
			&i.Author,
			&i.Series,
			&i.SeriesIndex,
			&i.Lang,
			&i.Description,
			&i.Words,
			&i.Gbid,
			&i.Olid,
			&i.Isbn10,
			&i.Isbn13,
			&i.Synced,
			&i.Deleted,
			&i.UpdatedAt,
			&i.CreatedAt,
			&i.Page,
			&i.Pages,
			&i.TotalTimeSeconds,
			&i.LastRead,
			&i.Percentage,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const getLastActivity = `-- name: GetLastActivity :one
SELECT start_time
FROM activity
WHERE device_id = ?1
AND user_id = ?2
ORDER BY start_time DESC LIMIT 1
`

type GetLastActivityParams struct {
	DeviceID string `json:"device_id"`
	UserID   string `json:"user_id"`
}

func (q *Queries) GetLastActivity(ctx context.Context, arg GetLastActivityParams) (time.Time, error) {
	row := q.db.QueryRowContext(ctx, getLastActivity, arg.DeviceID, arg.UserID)
	var start_time time.Time
	err := row.Scan(&start_time)
	return start_time, err
}

const getMissingDocuments = `-- name: GetMissingDocuments :many
SELECT documents.id, documents.md5, documents.filepath, documents.coverfile, documents.title, documents.author, documents.series, documents.series_index, documents.lang, documents.description, documents.words, documents.gbid, documents.olid, documents.isbn10, documents.isbn13, documents.synced, documents.deleted, documents.updated_at, documents.created_at FROM documents
WHERE
    documents.filepath IS NOT NULL
    AND documents.deleted = false
    AND documents.id NOT IN (/*SLICE:document_ids*/?)
`

func (q *Queries) GetMissingDocuments(ctx context.Context, documentIds []string) ([]Document, error) {
	query := getMissingDocuments
	var queryParams []interface{}
	if len(documentIds) > 0 {
		for _, v := range documentIds {
			queryParams = append(queryParams, v)
		}
		query = strings.Replace(query, "/*SLICE:document_ids*/?", strings.Repeat(",?", len(documentIds))[1:], 1)
	} else {
		query = strings.Replace(query, "/*SLICE:document_ids*/?", "NULL", 1)
	}
	rows, err := q.db.QueryContext(ctx, query, queryParams...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []Document
	for rows.Next() {
		var i Document
		if err := rows.Scan(
			&i.ID,
			&i.Md5,
			&i.Filepath,
			&i.Coverfile,
			&i.Title,
			&i.Author,
			&i.Series,
			&i.SeriesIndex,
			&i.Lang,
			&i.Description,
			&i.Words,
			&i.Gbid,
			&i.Olid,
			&i.Isbn10,
			&i.Isbn13,
			&i.Synced,
			&i.Deleted,
			&i.UpdatedAt,
			&i.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const getProgress = `-- name: GetProgress :one
SELECT
    document_progress.user_id, document_progress.document_id, document_progress.device_id, document_progress.percentage, document_progress.progress, document_progress.created_at,
    devices.device_name
FROM document_progress
JOIN devices ON document_progress.device_id = devices.id
WHERE
    document_progress.user_id = ?1
    AND document_progress.document_id = ?2
ORDER BY
    document_progress.created_at
    DESC
LIMIT 1
`

type GetProgressParams struct {
	UserID     string `json:"user_id"`
	DocumentID string `json:"document_id"`
}

type GetProgressRow struct {
	UserID     string    `json:"user_id"`
	DocumentID string    `json:"document_id"`
	DeviceID   string    `json:"device_id"`
	Percentage float64   `json:"percentage"`
	Progress   string    `json:"progress"`
	CreatedAt  time.Time `json:"created_at"`
	DeviceName string    `json:"device_name"`
}

func (q *Queries) GetProgress(ctx context.Context, arg GetProgressParams) (GetProgressRow, error) {
	row := q.db.QueryRowContext(ctx, getProgress, arg.UserID, arg.DocumentID)
	var i GetProgressRow
	err := row.Scan(
		&i.UserID,
		&i.DocumentID,
		&i.DeviceID,
		&i.Percentage,
		&i.Progress,
		&i.CreatedAt,
		&i.DeviceName,
	)
	return i, err
}

const getUser = `-- name: GetUser :one
SELECT id, pass, admin, time_offset, created_at FROM users
WHERE id = ?1 LIMIT 1
`

func (q *Queries) GetUser(ctx context.Context, userID string) (User, error) {
	row := q.db.QueryRowContext(ctx, getUser, userID)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Pass,
		&i.Admin,
		&i.TimeOffset,
		&i.CreatedAt,
	)
	return i, err
}

const getUserWindowStreaks = `-- name: GetUserWindowStreaks :one
WITH document_windows AS (
    SELECT
        CASE
          WHEN ?2 = "WEEK" THEN DATE(start_time, time_offset, 'weekday 0', '-7 day')
          WHEN ?2 = "DAY" THEN DATE(start_time, time_offset)
        END AS read_window,
        time_offset
    FROM activity
    JOIN users ON users.id = activity.user_id
    WHERE user_id = ?1
    AND CAST(?2 AS TEXT) = CAST(?2 AS TEXT)
    GROUP BY read_window
),
partitions AS (
    SELECT
        document_windows.read_window, document_windows.time_offset,
        row_number() OVER (
            PARTITION BY 1 ORDER BY read_window DESC
        ) AS seqnum
    FROM document_windows
),
streaks AS (
    SELECT
        COUNT(*) AS streak,
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
LIMIT 1
`

type GetUserWindowStreaksParams struct {
	UserID string `json:"user_id"`
	Window string `json:"window"`
}

type GetUserWindowStreaksRow struct {
	MaxStreak              int64       `json:"max_streak"`
	MaxStreakStartDate     string      `json:"max_streak_start_date"`
	MaxStreakEndDate       string      `json:"max_streak_end_date"`
	CurrentStreak          interface{} `json:"current_streak"`
	CurrentStreakStartDate string      `json:"current_streak_start_date"`
	CurrentStreakEndDate   string      `json:"current_streak_end_date"`
}

func (q *Queries) GetUserWindowStreaks(ctx context.Context, arg GetUserWindowStreaksParams) (GetUserWindowStreaksRow, error) {
	row := q.db.QueryRowContext(ctx, getUserWindowStreaks, arg.UserID, arg.Window)
	var i GetUserWindowStreaksRow
	err := row.Scan(
		&i.MaxStreak,
		&i.MaxStreakStartDate,
		&i.MaxStreakEndDate,
		&i.CurrentStreak,
		&i.CurrentStreakStartDate,
		&i.CurrentStreakEndDate,
	)
	return i, err
}

const getUsers = `-- name: GetUsers :many
SELECT id, pass, admin, time_offset, created_at FROM users
WHERE
    users.id = ?1
    OR ?1 IN (
        SELECT id
        FROM users
        WHERE id = ?1
        AND admin = 1
    )
ORDER BY created_at DESC
LIMIT ?3
OFFSET ?2
`

type GetUsersParams struct {
	User   string `json:"user"`
	Offset int64  `json:"offset"`
	Limit  int64  `json:"limit"`
}

func (q *Queries) GetUsers(ctx context.Context, arg GetUsersParams) ([]User, error) {
	rows, err := q.db.QueryContext(ctx, getUsers, arg.User, arg.Offset, arg.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []User
	for rows.Next() {
		var i User
		if err := rows.Scan(
			&i.ID,
			&i.Pass,
			&i.Admin,
			&i.TimeOffset,
			&i.CreatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const getWantedDocuments = `-- name: GetWantedDocuments :many
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
OR CAST(?1 AS TEXT) != CAST(?1 AS TEXT)
`

type GetWantedDocumentsRow struct {
	ID           string `json:"id"`
	WantFile     bool   `json:"want_file"`
	WantMetadata bool   `json:"want_metadata"`
}

func (q *Queries) GetWantedDocuments(ctx context.Context, documentIds string) ([]GetWantedDocumentsRow, error) {
	rows, err := q.db.QueryContext(ctx, getWantedDocuments, documentIds)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []GetWantedDocumentsRow
	for rows.Next() {
		var i GetWantedDocumentsRow
		if err := rows.Scan(&i.ID, &i.WantFile, &i.WantMetadata); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const updateDocumentDeleted = `-- name: UpdateDocumentDeleted :one
UPDATE documents
SET
  deleted = ?1
WHERE id = ?2
RETURNING id, md5, filepath, coverfile, title, author, series, series_index, lang, description, words, gbid, olid, isbn10, isbn13, synced, deleted, updated_at, created_at
`

type UpdateDocumentDeletedParams struct {
	Deleted bool   `json:"-"`
	ID      string `json:"id"`
}

func (q *Queries) UpdateDocumentDeleted(ctx context.Context, arg UpdateDocumentDeletedParams) (Document, error) {
	row := q.db.QueryRowContext(ctx, updateDocumentDeleted, arg.Deleted, arg.ID)
	var i Document
	err := row.Scan(
		&i.ID,
		&i.Md5,
		&i.Filepath,
		&i.Coverfile,
		&i.Title,
		&i.Author,
		&i.Series,
		&i.SeriesIndex,
		&i.Lang,
		&i.Description,
		&i.Words,
		&i.Gbid,
		&i.Olid,
		&i.Isbn10,
		&i.Isbn13,
		&i.Synced,
		&i.Deleted,
		&i.UpdatedAt,
		&i.CreatedAt,
	)
	return i, err
}

const updateDocumentSync = `-- name: UpdateDocumentSync :one
UPDATE documents
SET
    synced = ?1
WHERE id = ?2
RETURNING id, md5, filepath, coverfile, title, author, series, series_index, lang, description, words, gbid, olid, isbn10, isbn13, synced, deleted, updated_at, created_at
`

type UpdateDocumentSyncParams struct {
	Synced bool   `json:"-"`
	ID     string `json:"id"`
}

func (q *Queries) UpdateDocumentSync(ctx context.Context, arg UpdateDocumentSyncParams) (Document, error) {
	row := q.db.QueryRowContext(ctx, updateDocumentSync, arg.Synced, arg.ID)
	var i Document
	err := row.Scan(
		&i.ID,
		&i.Md5,
		&i.Filepath,
		&i.Coverfile,
		&i.Title,
		&i.Author,
		&i.Series,
		&i.SeriesIndex,
		&i.Lang,
		&i.Description,
		&i.Words,
		&i.Gbid,
		&i.Olid,
		&i.Isbn10,
		&i.Isbn13,
		&i.Synced,
		&i.Deleted,
		&i.UpdatedAt,
		&i.CreatedAt,
	)
	return i, err
}

const updateProgress = `-- name: UpdateProgress :one
INSERT OR REPLACE INTO document_progress (
    user_id,
    document_id,
    device_id,
    percentage,
    progress
)
VALUES (?, ?, ?, ?, ?)
RETURNING user_id, document_id, device_id, percentage, progress, created_at
`

type UpdateProgressParams struct {
	UserID     string  `json:"user_id"`
	DocumentID string  `json:"document_id"`
	DeviceID   string  `json:"device_id"`
	Percentage float64 `json:"percentage"`
	Progress   string  `json:"progress"`
}

func (q *Queries) UpdateProgress(ctx context.Context, arg UpdateProgressParams) (DocumentProgress, error) {
	row := q.db.QueryRowContext(ctx, updateProgress,
		arg.UserID,
		arg.DocumentID,
		arg.DeviceID,
		arg.Percentage,
		arg.Progress,
	)
	var i DocumentProgress
	err := row.Scan(
		&i.UserID,
		&i.DocumentID,
		&i.DeviceID,
		&i.Percentage,
		&i.Progress,
		&i.CreatedAt,
	)
	return i, err
}

const updateUser = `-- name: UpdateUser :one
UPDATE users
SET
    pass = COALESCE(?1, pass),
    time_offset = COALESCE(?2, time_offset)
WHERE id = ?3
RETURNING id, pass, admin, time_offset, created_at
`

type UpdateUserParams struct {
	Password   *string `json:"-"`
	TimeOffset *string `json:"time_offset"`
	UserID     string  `json:"user_id"`
}

func (q *Queries) UpdateUser(ctx context.Context, arg UpdateUserParams) (User, error) {
	row := q.db.QueryRowContext(ctx, updateUser, arg.Password, arg.TimeOffset, arg.UserID)
	var i User
	err := row.Scan(
		&i.ID,
		&i.Pass,
		&i.Admin,
		&i.TimeOffset,
		&i.CreatedAt,
	)
	return i, err
}

const upsertDevice = `-- name: UpsertDevice :one
INSERT INTO devices (id, user_id, device_name)
VALUES (?, ?, ?)
ON CONFLICT DO UPDATE
SET
    device_name = COALESCE(excluded.device_name, device_name)
RETURNING id, user_id, device_name, created_at, sync
`

type UpsertDeviceParams struct {
	ID         string `json:"id"`
	UserID     string `json:"user_id"`
	DeviceName string `json:"device_name"`
}

func (q *Queries) UpsertDevice(ctx context.Context, arg UpsertDeviceParams) (Device, error) {
	row := q.db.QueryRowContext(ctx, upsertDevice, arg.ID, arg.UserID, arg.DeviceName)
	var i Device
	err := row.Scan(
		&i.ID,
		&i.UserID,
		&i.DeviceName,
		&i.CreatedAt,
		&i.Sync,
	)
	return i, err
}

const upsertDocument = `-- name: UpsertDocument :one
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
RETURNING id, md5, filepath, coverfile, title, author, series, series_index, lang, description, words, gbid, olid, isbn10, isbn13, synced, deleted, updated_at, created_at
`

type UpsertDocumentParams struct {
	ID          string  `json:"id"`
	Md5         *string `json:"md5"`
	Filepath    *string `json:"filepath"`
	Coverfile   *string `json:"coverfile"`
	Title       *string `json:"title"`
	Author      *string `json:"author"`
	Series      *string `json:"series"`
	SeriesIndex *int64  `json:"series_index"`
	Lang        *string `json:"lang"`
	Description *string `json:"description"`
	Words       *int64  `json:"words"`
	Olid        *string `json:"-"`
	Gbid        *string `json:"gbid"`
	Isbn10      *string `json:"isbn10"`
	Isbn13      *string `json:"isbn13"`
}

func (q *Queries) UpsertDocument(ctx context.Context, arg UpsertDocumentParams) (Document, error) {
	row := q.db.QueryRowContext(ctx, upsertDocument,
		arg.ID,
		arg.Md5,
		arg.Filepath,
		arg.Coverfile,
		arg.Title,
		arg.Author,
		arg.Series,
		arg.SeriesIndex,
		arg.Lang,
		arg.Description,
		arg.Words,
		arg.Olid,
		arg.Gbid,
		arg.Isbn10,
		arg.Isbn13,
	)
	var i Document
	err := row.Scan(
		&i.ID,
		&i.Md5,
		&i.Filepath,
		&i.Coverfile,
		&i.Title,
		&i.Author,
		&i.Series,
		&i.SeriesIndex,
		&i.Lang,
		&i.Description,
		&i.Words,
		&i.Gbid,
		&i.Olid,
		&i.Isbn10,
		&i.Isbn13,
		&i.Synced,
		&i.Deleted,
		&i.UpdatedAt,
		&i.CreatedAt,
	)
	return i, err
}
