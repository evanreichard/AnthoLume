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
