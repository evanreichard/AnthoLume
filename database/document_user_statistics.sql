WITH new_activity AS (
    SELECT
        document_id,
        user_id
    FROM activity
    WHERE
        created_at > COALESCE(
            (SELECT MAX(last_seen) FROM document_user_statistics),
            '1970-01-01T00:00:00Z'
        )
    GROUP BY user_id, document_id
),

intermediate_ga AS (
    SELECT
        ga.id AS row_id,
        ga.user_id,
        ga.document_id,
        ga.duration,
        ga.start_time,
        ga.start_percentage,
        ga.end_percentage,
        ga.created_at,

        -- Find Overlapping Events (Assign Unique ID)
        (
            SELECT MIN(id)
            FROM activity AS overlap
            WHERE
                ga.document_id = overlap.document_id
                AND ga.user_id = overlap.user_id
                AND ga.start_percentage <= overlap.end_percentage
                AND ga.end_percentage >= overlap.start_percentage
        ) AS group_leader
    FROM activity AS ga
    INNER JOIN new_activity AS na
    WHERE na.user_id = ga.user_id AND na.document_id = ga.document_id
),

grouped_activity AS (
    SELECT
        user_id,
        document_id,
        MAX(created_at) AS created_at,
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

INSERT INTO document_user_statistics
SELECT
    ga.document_id,
    ga.user_id,
    cp.percentage,
    MAX(ga.start_time) AS last_read,
    MAX(ga.created_at) AS last_seen,
    SUM(ga.read_percentage) AS read_percentage,

    -- All Time WPM
    SUM(ga.duration) AS total_time_seconds,
    (CAST(COALESCE(d.words, 0.0) AS REAL) * SUM(read_percentage))
        AS total_words_read,
    (CAST(COALESCE(d.words, 0.0) AS REAL) * SUM(read_percentage))
    / (SUM(ga.duration) / 60.0) AS total_wpm,

    -- Yearly WPM
    SUM(
        CASE
            WHEN
                ga.start_time >= DATE('now', '-1 year')
                THEN ga.duration
            ELSE 0
        END
    )
        AS yearly_time_seconds,
    (
        CAST(COALESCE(d.words, 0.0) AS REAL)
        * SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-1 year')
                    THEN read_percentage
                ELSE 0
            END
        )
    )
        AS yearly_words_read,
    COALESCE((
        CAST(COALESCE(d.words, 0.0) AS REAL)
        * SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-1 year')
                    THEN read_percentage
            END
        )
    )
    / (
        SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-1 year')
                    THEN ga.duration
            END
        )
        / 60.0
    ), 0.0)
        AS yearly_wpm,

        -- Monthly WPM
    SUM(
        CASE
            WHEN
                ga.start_time >= DATE('now', '-1 month')
                THEN ga.duration
            ELSE 0
        END
    )
        AS monthly_time_seconds,
    (
        CAST(COALESCE(d.words, 0.0) AS REAL)
        * SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-1 month')
                    THEN read_percentage
                ELSE 0
            END
        )
    )
        AS monthly_words_read,
    COALESCE((
        CAST(COALESCE(d.words, 0.0) AS REAL)
        * SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-1 month')
                    THEN read_percentage
            END
        )
    )
    / (
        SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-1 month')
                    THEN ga.duration
            END
        )
        / 60.0
    ), 0.0)
        AS monthly_wpm,

        -- Weekly WPM
    SUM(
        CASE
            WHEN
                ga.start_time >= DATE('now', '-7 days')
                THEN ga.duration
            ELSE 0
        END
    )
        AS weekly_time_seconds,
    (
        CAST(COALESCE(d.words, 0.0) AS REAL)
        * SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-7 days')
                    THEN read_percentage
                ELSE 0
            END
        )
    )
        AS weekly_words_read,
    COALESCE((
        CAST(COALESCE(d.words, 0.0) AS REAL)
        * SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-7 days')
                    THEN read_percentage
            END
        )
    )
    / (
        SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-7 days')
                    THEN ga.duration
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
