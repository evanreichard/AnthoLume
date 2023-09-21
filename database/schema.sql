PRAGMA foreign_keys = ON;

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
    title TEXT,
    author TEXT,
    series TEXT,
    series_index INTEGER,
    lang TEXT,
    description TEXT,
    olid TEXT,
    synced BOOLEAN NOT NULL DEFAULT 0 CHECK (synced IN (0, 1)),
    deleted BOOLEAN NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),

    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    current_page INTEGER NOT NULL,
    total_pages INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (document_id) REFERENCES documents (id),
    FOREIGN KEY (device_id) REFERENCES devices (id)
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

WITH RECURSIVE numbers (idx) AS (
    SELECT 1 AS idx
    UNION ALL
    SELECT idx + 1
    FROM numbers
    LIMIT 1000
),

total_pages AS (
    SELECT
        document_id,
        total_pages AS pages
    FROM activity
    GROUP BY document_id
    HAVING MAX(start_time)
    ORDER BY start_time DESC
),

intermediate AS (
    SELECT
        activity.document_id,
        activity.device_id,
        activity.user_id,
        activity.current_page,
        activity.total_pages,
        total_pages.pages,
        activity.start_time,
        activity.duration,
        numbers.idx,
        -- Derive First Page
        ((activity.current_page - 1) * total_pages.pages) / activity.total_pages
        + 1 AS first_page,
        -- Derive Last Page
        MAX(
            ((activity.current_page - 1) * total_pages.pages)
            / activity.total_pages
            + 1,
            (activity.current_page * total_pages.pages) / activity.total_pages
        ) AS last_page
    FROM activity
    INNER JOIN total_pages ON total_pages.document_id = activity.document_id
    INNER JOIN numbers ON numbers.idx <= (last_page - first_page + 1)
)

SELECT
    document_id,
    device_id,
    user_id,
    start_time,
    first_page + idx - 1 AS page,
    duration / (last_page - first_page + 1) AS duration
FROM intermediate;
