PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

---------------------------------------------------------------
------------------------ Normal Tables ------------------------
---------------------------------------------------------------

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
    last_synced DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (document_id) REFERENCES documents (id),
    FOREIGN KEY (device_id) REFERENCES devices (id),
    PRIMARY KEY (user_id, document_id, device_id)
);

-- Raw Read Activity
CREATE TABLE IF NOT EXISTS raw_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    device_id TEXT NOT NULL,

    start_time DATETIME NOT NULL,
    page INTEGER NOT NULL,
    pages INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (document_id) REFERENCES documents (id),
    FOREIGN KEY (device_id) REFERENCES devices (id)
);

---------------------------------------------------------------
----------------------- Temporary Tables ----------------------
---------------------------------------------------------------

-- Temporary Activity Table (Cached from View)
CREATE TEMPORARY TABLE IF NOT EXISTS activity (
    user_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    device_id TEXT NOT NULL,

    created_at DATETIME NOT NULL,
    start_time DATETIME NOT NULL,
    page INTEGER NOT NULL,
    pages INTEGER NOT NULL,
    duration INTEGER NOT NULL
);

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

CREATE TEMPORARY TABLE IF NOT EXISTS document_user_statistics (
    document_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    last_read TEXT NOT NULL,
    page INTEGER NOT NULL,
    pages INTEGER NOT NULL,
    total_time_seconds INTEGER NOT NULL,
    read_pages INTEGER NOT NULL,
    percentage REAL NOT NULL,
    words_read INTEGER NOT NULL,
    wpm REAL NOT NULL
);


---------------------------------------------------------------
--------------------------- Indexes ---------------------------
---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS temp.activity_start_time ON activity (start_time);
CREATE INDEX IF NOT EXISTS temp.activity_user_id ON activity (user_id);
CREATE INDEX IF NOT EXISTS temp.activity_user_id_document_id ON activity (
    user_id,
    document_id
);

---------------------------------------------------------------
---------------------------- Views ----------------------------
---------------------------------------------------------------

--------------------------------
------- Rescaled Activity ------
--------------------------------

CREATE VIEW IF NOT EXISTS view_rescaled_activity AS

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
    FROM raw_activity
    GROUP BY document_id, user_id
    HAVING MAX(start_time)
    ORDER BY start_time DESC
),

intermediate AS (
    SELECT
        raw_activity.document_id,
        raw_activity.device_id,
        raw_activity.user_id,
        raw_activity.created_at,
        raw_activity.start_time,
        raw_activity.duration,
        raw_activity.page,
        current_pages.pages,

        -- Derive first page
        ((raw_activity.page - 1) * current_pages.pages) / raw_activity.pages
        + 1 AS first_page,

        -- Derive last page
        MAX(
            ((raw_activity.page - 1) * current_pages.pages)
            / raw_activity.pages
            + 1,
            (raw_activity.page * current_pages.pages) / raw_activity.pages
        ) AS last_page

    FROM raw_activity
    INNER JOIN current_pages ON
        current_pages.document_id = raw_activity.document_id
        AND current_pages.user_id = raw_activity.user_id
),

num_limit AS (
    SELECT * FROM nums
    LIMIT (SELECT MAX(last_page - first_page + 1) FROM intermediate)
),

rescaled_raw AS (
    SELECT
        intermediate.document_id,
        intermediate.device_id,
        intermediate.user_id,
        intermediate.created_at,
        intermediate.start_time,
        intermediate.last_page,
        intermediate.pages,
        intermediate.first_page + num_limit.idx - 1 AS page,
        intermediate.duration / (
            intermediate.last_page - intermediate.first_page + 1.0
        ) AS duration
    FROM intermediate
    LEFT JOIN num_limit ON
        num_limit.idx <= (intermediate.last_page - intermediate.first_page + 1)
)

SELECT
    user_id,
    document_id,
    device_id,
    created_at,
    start_time,
    page,
    pages,

    -- Round up if last page (maintains total duration)
    CAST(CASE
        WHEN page = last_page AND duration != CAST(duration AS INTEGER)
            THEN duration + 1
        ELSE duration
    END AS INTEGER) AS duration
FROM rescaled_raw;

--------------------------------
--------- User Streaks ---------
--------------------------------

CREATE VIEW IF NOT EXISTS view_user_streaks AS

WITH document_windows AS (
    SELECT
        activity.user_id,
        users.time_offset,
        DATE(
            activity.start_time,
            users.time_offset,
            'weekday 0', '-7 day'
        ) AS weekly_read,
        DATE(activity.start_time, users.time_offset) AS daily_read
    FROM raw_activity AS activity
    LEFT JOIN users ON users.id = activity.user_id
    GROUP BY activity.user_id, weekly_read, daily_read
),

weekly_partitions AS (
    SELECT
        user_id,
        time_offset,
        'WEEK' AS "window",
        weekly_read AS read_window,
        row_number() OVER (
            PARTITION BY user_id ORDER BY weekly_read DESC
        ) AS seqnum
    FROM document_windows
    GROUP BY user_id, weekly_read
),

daily_partitions AS (
    SELECT
        user_id,
        time_offset,
        'DAY' AS "window",
        daily_read AS read_window,
        row_number() OVER (
            PARTITION BY user_id ORDER BY daily_read DESC
        ) AS seqnum
    FROM document_windows
    GROUP BY user_id, daily_read
),

streaks AS (
    SELECT
        COUNT(*) AS streak,
        MIN(read_window) AS start_date,
        MAX(read_window) AS end_date,
        window,
        user_id,
        time_offset
    FROM daily_partitions
    GROUP BY
        time_offset,
        user_id,
        DATE(read_window, '+' || seqnum || ' day')

    UNION ALL

    SELECT
        COUNT(*) AS streak,
        MIN(read_window) AS start_date,
        MAX(read_window) AS end_date,
        window,
        user_id,
        time_offset
    FROM weekly_partitions
    GROUP BY
        time_offset,
        user_id,
        DATE(read_window, '+' || (seqnum * 7) || ' day')
),
max_streak AS (
    SELECT
        MAX(streak) AS max_streak,
        start_date AS max_streak_start_date,
        end_date AS max_streak_end_date,
        window,
        user_id
    FROM streaks
    GROUP BY user_id, window
),
current_streak AS (
    SELECT
        streak AS current_streak,
        start_date AS current_streak_start_date,
        end_date AS current_streak_end_date,
        window,
        user_id
    FROM streaks
    WHERE CASE
      WHEN window = "WEEK" THEN
          DATE('now', time_offset, 'weekday 0', '-14 day') = current_streak_end_date
          OR DATE('now', time_offset, 'weekday 0', '-7 day') = current_streak_end_date
      WHEN window = "DAY" THEN
          DATE('now', time_offset, '-1 day') = current_streak_end_date
          OR DATE('now', time_offset) = current_streak_end_date
    END
    GROUP BY user_id, window
)
SELECT
    max_streak.user_id,
    max_streak.window,
    IFNULL(max_streak, 0) AS max_streak,
    IFNULL(max_streak_start_date, "N/A") AS max_streak_start_date,
    IFNULL(max_streak_end_date, "N/A") AS max_streak_end_date,
    IFNULL(current_streak, 0) AS current_streak,
    IFNULL(current_streak_start_date, "N/A") AS current_streak_start_date,
    IFNULL(current_streak_end_date, "N/A") AS current_streak_end_date
FROM max_streak
LEFT JOIN current_streak ON
    current_streak.user_id = max_streak.user_id
    AND current_streak.window = max_streak.window;

--------------------------------
------- Document Stats ---------
--------------------------------

CREATE VIEW IF NOT EXISTS view_document_user_statistics AS

WITH true_progress AS (
    SELECT
        document_id,
        user_id,
        start_time AS last_read,
        page,
        pages,
        SUM(duration) AS total_time_seconds,

        -- Determine Read Pages
        COUNT(DISTINCT page) AS read_pages,

        -- Derive Percentage of Book
        ROUND(CAST(page AS REAL) / CAST(pages AS REAL) * 100, 2) AS percentage
    FROM view_rescaled_activity
    GROUP BY document_id, user_id
    HAVING MAX(start_time)
)
SELECT
    true_progress.*,
    (CAST(COALESCE(documents.words, 0.0) AS REAL) / pages * read_pages)
        AS words_read,
    (CAST(COALESCE(documents.words, 0.0) AS REAL) / pages * read_pages)
    / (total_time_seconds / 60.0) AS wpm
FROM true_progress
INNER JOIN documents ON documents.id = true_progress.document_id
ORDER BY wpm DESC;

---------------------------------------------------------------
------------------ Populate Temporary Tables ------------------
---------------------------------------------------------------
INSERT INTO activity SELECT * FROM view_rescaled_activity;
INSERT INTO user_streaks SELECT * FROM view_user_streaks;
INSERT INTO document_user_statistics SELECT * FROM view_document_user_statistics;

---------------------------------------------------------------
--------------------------- Triggers --------------------------
---------------------------------------------------------------

-- Update Trigger
CREATE TRIGGER IF NOT EXISTS update_documents_updated_at
BEFORE UPDATE ON documents BEGIN
UPDATE documents
SET updated_at = CURRENT_TIMESTAMP
WHERE id = old.id;
END;
