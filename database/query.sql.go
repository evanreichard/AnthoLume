// Code generated by sqlc. DO NOT EDIT.
// versions:
//   sqlc v1.21.0
// source: query.sql

package database

import (
	"context"
	"strings"
)

const addActivity = `-- name: AddActivity :one
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
RETURNING id, user_id, document_id, device_id, start_time, start_percentage, end_percentage, duration, created_at
`

type AddActivityParams struct {
	UserID          string  `json:"user_id"`
	DocumentID      string  `json:"document_id"`
	DeviceID        string  `json:"device_id"`
	StartTime       string  `json:"start_time"`
	Duration        int64   `json:"duration"`
	StartPercentage float64 `json:"start_percentage"`
	EndPercentage   float64 `json:"end_percentage"`
}

func (q *Queries) AddActivity(ctx context.Context, arg AddActivityParams) (Activity, error) {
	row := q.db.QueryRowContext(ctx, addActivity,
		arg.UserID,
		arg.DocumentID,
		arg.DeviceID,
		arg.StartTime,
		arg.Duration,
		arg.StartPercentage,
		arg.EndPercentage,
	)
	var i Activity
	err := row.Scan(
		&i.ID,
		&i.UserID,
		&i.DocumentID,
		&i.DeviceID,
		&i.StartTime,
		&i.StartPercentage,
		&i.EndPercentage,
		&i.Duration,
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
        activity.user_id = ?1
        AND (
            (
                CAST(?2 AS BOOLEAN) = TRUE
                AND document_id = ?3
            ) OR ?2 = FALSE
        )
    ORDER BY start_time DESC
    LIMIT ?5
    OFFSET ?4
)

SELECT
    document_id,
    device_id,
    CAST(STRFTIME('%Y-%m-%d %H:%M:%S', activity.start_time, users.time_offset) AS TEXT) AS start_time,
    title,
    author,
    duration,
    start_percentage,
    end_percentage,
    read_percentage
FROM filtered_activity AS activity
LEFT JOIN documents ON documents.id = activity.document_id
LEFT JOIN users ON users.id = activity.user_id
`

type GetActivityParams struct {
	UserID     string `json:"user_id"`
	DocFilter  bool   `json:"doc_filter"`
	DocumentID string `json:"document_id"`
	Offset     int64  `json:"offset"`
	Limit      int64  `json:"limit"`
}

type GetActivityRow struct {
	DocumentID      string  `json:"document_id"`
	DeviceID        string  `json:"device_id"`
	StartTime       string  `json:"start_time"`
	Title           *string `json:"title"`
	Author          *string `json:"author"`
	Duration        int64   `json:"duration"`
	StartPercentage float64 `json:"start_percentage"`
	EndPercentage   float64 `json:"end_percentage"`
	ReadPercentage  float64 `json:"read_percentage"`
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
			&i.DeviceID,
			&i.StartTime,
			&i.Title,
			&i.Author,
			&i.Duration,
			&i.StartPercentage,
			&i.EndPercentage,
			&i.ReadPercentage,
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
filtered_activity AS (
    SELECT
        user_id,
        start_time,
        duration
    FROM activity
    WHERE start_time > DATE('now', '-31 days')
    AND activity.user_id = ?1
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
SELECT id, user_id, device_name, last_synced, created_at, sync FROM devices
WHERE id = ?1 LIMIT 1
`

func (q *Queries) GetDevice(ctx context.Context, deviceID string) (Device, error) {
	row := q.db.QueryRowContext(ctx, getDevice, deviceID)
	var i Device
	err := row.Scan(
		&i.ID,
		&i.UserID,
		&i.DeviceName,
		&i.LastSynced,
		&i.CreatedAt,
		&i.Sync,
	)
	return i, err
}

const getDevices = `-- name: GetDevices :many
SELECT
    devices.id,
    devices.device_name,
    CAST(STRFTIME('%Y-%m-%d %H:%M:%S', devices.created_at, users.time_offset) AS TEXT) AS created_at,
    CAST(STRFTIME('%Y-%m-%d %H:%M:%S', devices.last_synced, users.time_offset) AS TEXT) AS last_synced
FROM devices
JOIN users ON users.id = devices.user_id
WHERE users.id = ?1
ORDER BY devices.last_synced DESC
`

type GetDevicesRow struct {
	ID         string `json:"id"`
	DeviceName string `json:"device_name"`
	CreatedAt  string `json:"created_at"`
	LastSynced string `json:"last_synced"`
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
		if err := rows.Scan(
			&i.ID,
			&i.DeviceName,
			&i.CreatedAt,
			&i.LastSynced,
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

const getDocumentWithStats = `-- name: GetDocumentWithStats :one
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
    COALESCE(dus.read_percentage, 0) AS read_percentage,
    COALESCE(dus.total_time_seconds, 0) AS total_time_seconds,
    STRFTIME('%Y-%m-%d %H:%M:%S', COALESCE(dus.last_read, "1970-01-01"), users.time_offset)
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
LEFT JOIN users ON users.id = ?1
LEFT JOIN
    document_user_statistics AS dus
    ON dus.document_id = docs.id AND dus.user_id = ?1
WHERE users.id = ?1
AND docs.id = ?2
LIMIT 1
`

type GetDocumentWithStatsParams struct {
	UserID     string `json:"user_id"`
	DocumentID string `json:"document_id"`
}

type GetDocumentWithStatsRow struct {
	ID                string      `json:"id"`
	Title             *string     `json:"title"`
	Author            *string     `json:"author"`
	Description       *string     `json:"description"`
	Isbn10            *string     `json:"isbn10"`
	Isbn13            *string     `json:"isbn13"`
	Filepath          *string     `json:"filepath"`
	Words             *int64      `json:"words"`
	Wpm               int64       `json:"wpm"`
	ReadPercentage    float64     `json:"read_percentage"`
	TotalTimeSeconds  int64       `json:"total_time_seconds"`
	LastRead          interface{} `json:"last_read"`
	Percentage        float64     `json:"percentage"`
	SecondsPerPercent int64       `json:"seconds_per_percent"`
}

func (q *Queries) GetDocumentWithStats(ctx context.Context, arg GetDocumentWithStatsParams) (GetDocumentWithStatsRow, error) {
	row := q.db.QueryRowContext(ctx, getDocumentWithStats, arg.UserID, arg.DocumentID)
	var i GetDocumentWithStatsRow
	err := row.Scan(
		&i.ID,
		&i.Title,
		&i.Author,
		&i.Description,
		&i.Isbn10,
		&i.Isbn13,
		&i.Filepath,
		&i.Words,
		&i.Wpm,
		&i.ReadPercentage,
		&i.TotalTimeSeconds,
		&i.LastRead,
		&i.Percentage,
		&i.SecondsPerPercent,
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

const getDocumentsSize = `-- name: GetDocumentsSize :one
SELECT
    COUNT(rowid) AS length
FROM documents AS docs
WHERE ?1 IS NULL OR (
    docs.title LIKE ?1 OR
    docs.author LIKE ?1
)
LIMIT 1
`

func (q *Queries) GetDocumentsSize(ctx context.Context, query interface{}) (int64, error) {
	row := q.db.QueryRowContext(ctx, getDocumentsSize, query)
	var length int64
	err := row.Scan(&length)
	return length, err
}

const getDocumentsWithStats = `-- name: GetDocumentsWithStats :many
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
    COALESCE(dus.read_percentage, 0) AS read_percentage,
    COALESCE(dus.total_time_seconds, 0) AS total_time_seconds,
    STRFTIME('%Y-%m-%d %H:%M:%S', COALESCE(dus.last_read, "1970-01-01"), users.time_offset)
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
LEFT JOIN users ON users.id = ?1
LEFT JOIN
    document_user_statistics AS dus
    ON dus.document_id = docs.id AND dus.user_id = ?1
WHERE
    docs.deleted = false AND (
        ?2 IS NULL OR (
            docs.title LIKE ?2 OR
            docs.author LIKE ?2
        )
    )
ORDER BY dus.last_read DESC, docs.created_at DESC
LIMIT ?4
OFFSET ?3
`

type GetDocumentsWithStatsParams struct {
	UserID string      `json:"user_id"`
	Query  interface{} `json:"query"`
	Offset int64       `json:"offset"`
	Limit  int64       `json:"limit"`
}

type GetDocumentsWithStatsRow struct {
	ID                string      `json:"id"`
	Title             *string     `json:"title"`
	Author            *string     `json:"author"`
	Description       *string     `json:"description"`
	Isbn10            *string     `json:"isbn10"`
	Isbn13            *string     `json:"isbn13"`
	Filepath          *string     `json:"filepath"`
	Words             *int64      `json:"words"`
	Wpm               int64       `json:"wpm"`
	ReadPercentage    float64     `json:"read_percentage"`
	TotalTimeSeconds  int64       `json:"total_time_seconds"`
	LastRead          interface{} `json:"last_read"`
	Percentage        float64     `json:"percentage"`
	SecondsPerPercent interface{} `json:"seconds_per_percent"`
}

func (q *Queries) GetDocumentsWithStats(ctx context.Context, arg GetDocumentsWithStatsParams) ([]GetDocumentsWithStatsRow, error) {
	rows, err := q.db.QueryContext(ctx, getDocumentsWithStats,
		arg.UserID,
		arg.Query,
		arg.Offset,
		arg.Limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []GetDocumentsWithStatsRow
	for rows.Next() {
		var i GetDocumentsWithStatsRow
		if err := rows.Scan(
			&i.ID,
			&i.Title,
			&i.Author,
			&i.Description,
			&i.Isbn10,
			&i.Isbn13,
			&i.Filepath,
			&i.Words,
			&i.Wpm,
			&i.ReadPercentage,
			&i.TotalTimeSeconds,
			&i.LastRead,
			&i.Percentage,
			&i.SecondsPerPercent,
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

func (q *Queries) GetLastActivity(ctx context.Context, arg GetLastActivityParams) (string, error) {
	row := q.db.QueryRowContext(ctx, getLastActivity, arg.DeviceID, arg.UserID)
	var start_time string
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
	UserID     string  `json:"user_id"`
	DocumentID string  `json:"document_id"`
	DeviceID   string  `json:"device_id"`
	Percentage float64 `json:"percentage"`
	Progress   string  `json:"progress"`
	CreatedAt  string  `json:"created_at"`
	DeviceName string  `json:"device_name"`
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

const getUserStreaks = `-- name: GetUserStreaks :many
SELECT user_id, "window", max_streak, max_streak_start_date, max_streak_end_date, current_streak, current_streak_start_date, current_streak_end_date FROM user_streaks
WHERE user_id = ?1
`

func (q *Queries) GetUserStreaks(ctx context.Context, userID string) ([]UserStreak, error) {
	rows, err := q.db.QueryContext(ctx, getUserStreaks, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []UserStreak
	for rows.Next() {
		var i UserStreak
		if err := rows.Scan(
			&i.UserID,
			&i.Window,
			&i.MaxStreak,
			&i.MaxStreakStartDate,
			&i.MaxStreakEndDate,
			&i.CurrentStreak,
			&i.CurrentStreakStartDate,
			&i.CurrentStreakEndDate,
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

const getWPMLeaderboard = `-- name: GetWPMLeaderboard :many
SELECT
    user_id,
    CAST(SUM(words_read) AS INTEGER) AS total_words_read,
    CAST(SUM(total_time_seconds) AS INTEGER) AS total_seconds,
    ROUND(CAST(SUM(words_read) AS REAL) / (SUM(total_time_seconds) / 60.0), 2)
        AS wpm
FROM document_user_statistics
WHERE words_read > 0
GROUP BY user_id
ORDER BY wpm DESC
`

type GetWPMLeaderboardRow struct {
	UserID         string  `json:"user_id"`
	TotalWordsRead int64   `json:"total_words_read"`
	TotalSeconds   int64   `json:"total_seconds"`
	Wpm            float64 `json:"wpm"`
}

func (q *Queries) GetWPMLeaderboard(ctx context.Context) ([]GetWPMLeaderboardRow, error) {
	rows, err := q.db.QueryContext(ctx, getWPMLeaderboard)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []GetWPMLeaderboardRow
	for rows.Next() {
		var i GetWPMLeaderboardRow
		if err := rows.Scan(
			&i.UserID,
			&i.TotalWordsRead,
			&i.TotalSeconds,
			&i.Wpm,
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
INSERT INTO devices (id, user_id, last_synced, device_name)
VALUES (?, ?, ?, ?)
ON CONFLICT DO UPDATE
SET
    device_name = COALESCE(excluded.device_name, device_name),
    last_synced = COALESCE(excluded.last_synced, last_synced)
RETURNING id, user_id, device_name, last_synced, created_at, sync
`

type UpsertDeviceParams struct {
	ID         string `json:"id"`
	UserID     string `json:"user_id"`
	LastSynced string `json:"last_synced"`
	DeviceName string `json:"device_name"`
}

func (q *Queries) UpsertDevice(ctx context.Context, arg UpsertDeviceParams) (Device, error) {
	row := q.db.QueryRowContext(ctx, upsertDevice,
		arg.ID,
		arg.UserID,
		arg.LastSynced,
		arg.DeviceName,
	)
	var i Device
	err := row.Scan(
		&i.ID,
		&i.UserID,
		&i.DeviceName,
		&i.LastSynced,
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
