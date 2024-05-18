---------------------------------------------------------------
---------------------------- Views ----------------------------
---------------------------------------------------------------

--------------------------------
--------- User Streaks ---------
--------------------------------

CREATE VIEW view_user_streaks AS

WITH document_windows AS (
    SELECT
        activity.user_id,
        users.timezone,
        DATE(
            LOCAL_TIME(activity.start_time, users.timezone),
            'weekday 0', '-7 day'
        ) AS weekly_read,
        DATE(LOCAL_TIME(activity.start_time, users.timezone)) AS daily_read
    FROM activity
    LEFT JOIN users ON users.id = activity.user_id
    GROUP BY activity.user_id, weekly_read, daily_read
),
weekly_partitions AS (
    SELECT
        user_id,
        timezone,
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
        timezone,
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
        timezone
    FROM daily_partitions
    GROUP BY
        timezone,
        user_id,
        DATE(read_window, '+' || seqnum || ' day')

    UNION ALL

    SELECT
        COUNT(*) AS streak,
        MIN(read_window) AS start_date,
        MAX(read_window) AS end_date,
        window,
        user_id,
        timezone
    FROM weekly_partitions
    GROUP BY
        timezone,
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
          DATE(LOCAL_TIME(STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'), timezone), 'weekday 0', '-14 day') = current_streak_end_date
          OR DATE(LOCAL_TIME(STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'), timezone), 'weekday 0', '-7 day') = current_streak_end_date
      WHEN window = "DAY" THEN
          DATE(LOCAL_TIME(STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'), timezone), '-1 day') = current_streak_end_date
          OR DATE(LOCAL_TIME(STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'), timezone)) = current_streak_end_date
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
