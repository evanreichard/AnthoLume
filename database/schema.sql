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

    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
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

-- Temporary Document User Statistics Table (Cached from View)
CREATE TEMPORARY TABLE IF NOT EXISTS document_user_statistics (
    document_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    percentage REAL NOT NULL,
    last_read TEXT NOT NULL,
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
--------------------------- Indexes ---------------------------
---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS activity_start_time ON activity (start_time);
CREATE INDEX IF NOT EXISTS activity_user_id ON activity (user_id);
CREATE INDEX IF NOT EXISTS activity_user_id_document_id ON activity (
    user_id,
    document_id
);


---------------------------------------------------------------
---------------------------- Views ----------------------------
---------------------------------------------------------------

DROP VIEW IF EXISTS view_user_streaks;
DROP VIEW IF EXISTS view_document_user_statistics;

--------------------------------
--------- User Streaks ---------
--------------------------------

CREATE VIEW view_user_streaks AS

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
    FROM activity
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

CREATE VIEW view_document_user_statistics AS

WITH intermediate_ga AS (
    SELECT
        ga1.id AS row_id,
        ga1.user_id,
        ga1.document_id,
        ga1.duration,
        ga1.start_time,
        ga1.start_percentage,
        ga1.end_percentage,

        -- Find Overlapping Events (Assign Unique ID)
        (
            SELECT MIN(id)
            FROM activity AS ga2
            WHERE
                ga1.document_id = ga2.document_id
                AND ga1.user_id = ga2.user_id
                AND ga1.start_percentage <= ga2.end_percentage
                AND ga1.end_percentage >= ga2.start_percentage
        ) AS group_leader
    FROM activity AS ga1
),

grouped_activity AS (
    SELECT
        user_id,
        document_id,
        MAX(start_time) AS start_time,
        MIN(start_percentage) AS start_percentage,
        MAX(end_percentage) AS end_percentage,
        MAX(end_percentage) - MIN(start_percentage) AS read_percentage,
        SUM(duration) AS duration
    FROM intermediate_ga
    GROUP BY group_leader
),

current_progress AS (
    SELECT
        user_id,
        document_id,
        COALESCE((
            SELECT percentage
            FROM document_progress AS dp
            WHERE
                dp.user_id = iga.user_id
                AND dp.document_id = iga.document_id
            ORDER BY created_at DESC
            LIMIT 1
        ), end_percentage) AS percentage
    FROM intermediate_ga AS iga
    GROUP BY user_id, document_id
    HAVING MAX(start_time)
)

SELECT
    ga.document_id,
    ga.user_id,
    cp.percentage,
    MAX(start_time) AS last_read,
    SUM(read_percentage) AS read_percentage,

    -- All Time WPM
    SUM(duration) AS total_time_seconds,
    (CAST(COALESCE(d.words, 0.0) AS REAL) * SUM(read_percentage))
        AS total_words_read,
    (CAST(COALESCE(d.words, 0.0) AS REAL) * SUM(read_percentage))
    / (SUM(duration) / 60.0) AS total_wpm,

    -- Yearly WPM
    SUM(CASE WHEN start_time >= DATE('now', '-1 year') THEN duration ELSE 0 END)
        AS yearly_time_seconds,
    (
        CAST(COALESCE(d.words, 0.0) AS REAL)
        * SUM(
            CASE
                WHEN start_time >= DATE('now', '-1 year') THEN read_percentage
                ELSE 0
            END
        )
    )
        AS yearly_words_read,
    COALESCE((
        CAST(COALESCE(d.words, 0.0) AS REAL)
        * SUM(
            CASE
                WHEN start_time >= DATE('now', '-1 year') THEN read_percentage
            END
        )
    )
    / (
        SUM(
            CASE
                WHEN start_time >= DATE('now', '-1 year') THEN duration
            END
        )
        / 60.0
    ), 0.0)
        AS yearly_wpm,

    -- Monthly WPM
    SUM(
        CASE WHEN start_time >= DATE('now', '-1 month') THEN duration ELSE 0 END
    )
        AS monthly_time_seconds,
    (
        CAST(COALESCE(d.words, 0.0) AS REAL)
        * SUM(
            CASE
                WHEN start_time >= DATE('now', '-1 month') THEN read_percentage
                ELSE 0
            END
        )
    )
        AS monthly_words_read,
    COALESCE((
        CAST(COALESCE(d.words, 0.0) AS REAL)
        * SUM(
            CASE
                WHEN start_time >= DATE('now', '-1 month') THEN read_percentage
            END
        )
    )
    / (
        SUM(
            CASE
                WHEN start_time >= DATE('now', '-1 month') THEN duration
            END
        )
        / 60.0
    ), 0.0)
        AS monthly_wpm,

    -- Weekly WPM
    SUM(CASE WHEN start_time >= DATE('now', '-7 days') THEN duration ELSE 0 END)
        AS weekly_time_seconds,
    (
        CAST(COALESCE(d.words, 0.0) AS REAL)
        * SUM(
            CASE
                WHEN start_time >= DATE('now', '-7 days') THEN read_percentage
                ELSE 0
            END
        )
    )
        AS weekly_words_read,
    COALESCE((
        CAST(COALESCE(d.words, 0.0) AS REAL)
        * SUM(
            CASE
                WHEN start_time >= DATE('now', '-7 days') THEN read_percentage
            END
        )
    )
    / (
        SUM(
            CASE
                WHEN start_time >= DATE('now', '-7 days') THEN duration
            END
        )
        / 60.0
    ), 0.0)
        AS weekly_wpm

FROM grouped_activity AS ga
INNER JOIN
    current_progress AS cp
    ON ga.user_id = cp.user_id AND ga.document_id = cp.document_id
INNER JOIN
    documents AS d
    ON ga.document_id = d.id
GROUP BY ga.document_id, ga.user_id
ORDER BY total_wpm DESC;


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
