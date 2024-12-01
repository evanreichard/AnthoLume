---------------------------------------------------------------
------------------------ Normal Tables ------------------------
---------------------------------------------------------------

-- Authentication
CREATE TABLE IF NOT EXISTS users (
    id TEXT NOT NULL PRIMARY KEY,

    pass TEXT NOT NULL,
    auth_hash TEXT NOT NULL,
    admin BOOLEAN NOT NULL DEFAULT 0 CHECK (admin IN (0, 1)),
    timezone TEXT NOT NULL DEFAULT 'Europe/London',

    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Books / Documents
CREATE TABLE IF NOT EXISTS documents (
    id TEXT NOT NULL PRIMARY KEY,

    md5 TEXT,
    basepath TEXT,
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

    updated_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
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

    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (document_id) REFERENCES documents (id)
);

-- Devices
CREATE TABLE IF NOT EXISTS devices (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,

    device_name TEXT NOT NULL,
    last_synced DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
    sync BOOLEAN NOT NULL DEFAULT 1 CHECK (sync IN (0, 1)),

    FOREIGN KEY (user_id) REFERENCES users (id)
);

-- User Document Progress
CREATE TABLE IF NOT EXISTS document_progress (
    user_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    device_id TEXT NOT NULL,

    percentage REAL NOT NULL,
    progress TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),

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
    start_percentage REAL NOT NULL,
    end_percentage REAL NOT NULL,

    duration INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),

    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (document_id) REFERENCES documents (id),
    FOREIGN KEY (device_id) REFERENCES devices (id)
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    name TEXT NOT NULL,
    value TEXT NOT NULL,

    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Document User Statistics Table
CREATE TABLE IF NOT EXISTS document_user_statistics (
    document_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    percentage REAL NOT NULL,
    last_read DATETIME NOT NULL,
    last_seen DATETIME NOT NULL,
    read_percentage REAL NOT NULL,

    total_time_seconds INTEGER NOT NULL,
    total_words_read INTEGER NOT NULL,
    total_wpm REAL NOT NULL,

    yearly_time_seconds INTEGER NOT NULL,
    yearly_words_read INTEGER NOT NULL,
    yearly_wpm REAL NOT NULL,

    monthly_time_seconds INTEGER NOT NULL,
    monthly_words_read INTEGER NOT NULL,
    monthly_wpm REAL NOT NULL,

    weekly_time_seconds INTEGER NOT NULL,
    weekly_words_read INTEGER NOT NULL,
    weekly_wpm REAL NOT NULL,

    UNIQUE(document_id, user_id) ON CONFLICT REPLACE
);

---------------------------------------------------------------
----------------------- Temporary Tables ----------------------
---------------------------------------------------------------

-- Temporary User Streaks Table (Cached from View)
CREATE TEMPORARY TABLE IF NOT EXISTS user_streaks (
    user_id TEXT NOT NULL,
    window TEXT NOT NULL,

    max_streak INTEGER NOT NULL,
    max_streak_start_date TEXT NOT NULL,
    max_streak_end_date TEXT NOT NULL,

    current_streak INTEGER NOT NULL,
    current_streak_start_date TEXT NOT NULL,
    current_streak_end_date TEXT NOT NULL
);

---------------------------------------------------------------
--------------------------- Indexes ---------------------------
---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS activity_start_time ON activity (start_time);
CREATE INDEX IF NOT EXISTS activity_user_id ON activity (user_id);
CREATE INDEX IF NOT EXISTS activity_user_id_document_id ON activity (
    user_id,
    document_id
);

DROP VIEW IF EXISTS view_user_streaks;

---------------------------------------------------------------
--------------------------- Triggers --------------------------
---------------------------------------------------------------

-- Update Trigger
CREATE TRIGGER IF NOT EXISTS update_documents_updated_at
BEFORE UPDATE ON documents BEGIN
UPDATE documents
SET updated_at = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = old.id;
END;

-- Delete User
CREATE TRIGGER IF NOT EXISTS user_deleted
BEFORE DELETE ON users BEGIN
DELETE FROM activity WHERE activity.user_id=OLD.id;
DELETE FROM devices WHERE devices.user_id=OLD.id;
DELETE FROM document_progress WHERE document_progress.user_id=OLD.id;
END;
