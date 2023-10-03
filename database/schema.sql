PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Authentication
CREATE TABLE IF NOT EXISTS users (
    id TEXT NOT NULL PRIMARY KEY,

    pass TEXT NOT NULL,
    admin BOOLEAN NOT NULL DEFAULT 0 CHECK (admin IN (0, 1)),
    time_offset TEXT NOT NULL DEFAULT '0 hours',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Books / Documents
CREATE TABLE IF NOT EXISTS documents (
    id TEXT NOT NULL PRIMARY KEY,

    md5 TEXT,
    filepath TEXT,
    coverfile TEXT,
    title TEXT,
    author TEXT,
    series TEXT,
    series_index INTEGER,
    lang TEXT,
    description TEXT,
    words INTEGER,

    gbid TEXT,
    olid TEXT,
    isbn10 TEXT,
    isbn13 TEXT,

    synced BOOLEAN NOT NULL DEFAULT 0 CHECK (synced IN (0, 1)),
    deleted BOOLEAN NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),

    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Metadata
CREATE TABLE IF NOT EXISTS metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    document_id TEXT NOT NULL,

    title TEXT,
    author TEXT,
    description TEXT,
    gbid TEXT,
    olid TEXT,
    isbn10 TEXT,
    isbn13 TEXT,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (document_id) REFERENCES documents (id)
);

-- Devices
CREATE TABLE IF NOT EXISTS devices (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,

    device_name TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sync BOOLEAN NOT NULL DEFAULT 1 CHECK (sync IN (0, 1)),

    FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Document Device Sync
CREATE TABLE IF NOT EXISTS document_device_sync (
    user_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    device_id TEXT NOT NULL,

    last_synced DATETIME NOT NULL,
    sync BOOLEAN NOT NULL DEFAULT 1 CHECK (sync IN (0, 1)),

    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (document_id) REFERENCES documents (id),
    FOREIGN KEY (device_id) REFERENCES devices (id),
    PRIMARY KEY (user_id, document_id, device_id)
);

-- User Document Progress
CREATE TABLE IF NOT EXISTS document_progress (
    user_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    device_id TEXT NOT NULL,

    percentage REAL NOT NULL,
    progress TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (document_id) REFERENCES documents (id),
    FOREIGN KEY (device_id) REFERENCES devices (id),
    PRIMARY KEY (user_id, document_id, device_id)
);

-- Read Activity
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    device_id TEXT NOT NULL,

    start_time DATETIME NOT NULL,
    duration INTEGER NOT NULL,
    page INTEGER NOT NULL,
    pages INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (document_id) REFERENCES documents (id),
    FOREIGN KEY (device_id) REFERENCES devices (id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS activity_start_time ON activity (start_time);
CREATE INDEX IF NOT EXISTS activity_user_id_document_id ON activity (
    user_id,
    document_id
);

-- Update Trigger
CREATE TRIGGER IF NOT EXISTS update_documents_updated_at
BEFORE UPDATE ON documents BEGIN
UPDATE documents
SET updated_at = CURRENT_TIMESTAMP
WHERE id = old.id;
END;

-- Rescaled Activity View (Adapted from KOReader)
CREATE VIEW IF NOT EXISTS rescaled_activity AS

WITH RECURSIVE nums (idx) AS (
    SELECT 1 AS idx
    UNION ALL
    SELECT idx + 1
    FROM nums
    LIMIT 1000
),

current_pages AS (
    SELECT
        document_id,
        user_id,
        pages
    FROM activity
    GROUP BY document_id, user_id
    HAVING MAX(start_time)
    ORDER BY start_time DESC
),

intermediate AS (
    SELECT
        activity.document_id,
        activity.device_id,
        activity.user_id,
        activity.start_time,
        activity.duration,
        activity.page,
        current_pages.pages,

        -- Derive first page
        ((activity.page - 1) * current_pages.pages) / activity.pages
        + 1 AS first_page,

        -- Derive last page
        MAX(
            ((activity.page - 1) * current_pages.pages)
            / activity.pages
            + 1,
            (activity.page * current_pages.pages) / activity.pages
        ) AS last_page

    FROM activity
    INNER JOIN current_pages ON
        current_pages.document_id = activity.document_id
        AND current_pages.user_id = activity.user_id
),

-- Improves performance
num_limit AS (
    SELECT * FROM nums
    LIMIT (SELECT MAX(last_page - first_page + 1) FROM intermediate)
),

rescaled_raw AS (
    SELECT
        document_id,
        device_id,
        user_id,
        start_time,
        last_page,
	pages,
        first_page + num_limit.idx - 1 AS page,
        duration / (
            last_page - first_page + 1.0
        ) AS duration
    FROM intermediate
    JOIN num_limit ON
        num_limit.idx <= (last_page - first_page + 1)
)

SELECT
    document_id,
    device_id,
    user_id,
    start_time,
    pages,
    page,

    -- Round up if last page (maintains total duration)
    CAST(CASE
        WHEN page = last_page AND duration != CAST(duration AS INTEGER)
            THEN duration + 1
        ELSE duration
    END AS INTEGER) AS duration
FROM rescaled_raw;
