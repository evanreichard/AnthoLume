WITH grouped_activity AS (
    SELECT
        ga.user_id,
        ga.document_id,
        MAX(ga.created_at) AS created_at,
        MAX(ga.start_time) AS start_time,
        MIN(ga.start_percentage) AS start_percentage,
        MAX(ga.end_percentage) AS end_percentage,

        -- Total Duration & Percentage
        SUM(ga.duration) AS total_time_seconds,
        SUM(ga.end_percentage - ga.start_percentage) AS total_read_percentage,

        -- Yearly Duration
        SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-1 year')
                    THEN ga.duration
                ELSE 0
            END
        )
            AS yearly_time_seconds,

        -- Yearly Percentage
        SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-1 year')
                    THEN ga.end_percentage - ga.start_percentage
                ELSE 0
            END
        )
            AS yearly_read_percentage,

        -- Monthly Duration
        SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-1 month')
                    THEN ga.duration
                ELSE 0
            END
        )
            AS monthly_time_seconds,

        -- Monthly Percentage
        SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-1 month')
                    THEN ga.end_percentage - ga.start_percentage
                ELSE 0
            END
        )
            AS monthly_read_percentage,

        -- Weekly Duration
        SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-7 days')
                    THEN ga.duration
                ELSE 0
            END
        )
            AS weekly_time_seconds,

        -- Weekly Percentage
        SUM(
            CASE
                WHEN
                    ga.start_time >= DATE('now', '-7 days')
                    THEN ga.end_percentage - ga.start_percentage
                ELSE 0
            END
        )
            AS weekly_read_percentage

    FROM activity AS ga
    GROUP BY ga.user_id, ga.document_id
),

current_progress AS (
    SELECT
        user_id,
        document_id,
        COALESCE((
            SELECT dp.percentage
            FROM document_progress AS dp
            WHERE
                dp.user_id = iga.user_id
                AND dp.document_id = iga.document_id
            ORDER BY dp.created_at DESC
            LIMIT 1
        ), end_percentage) AS percentage
    FROM grouped_activity AS iga
)

INSERT INTO document_user_statistics
SELECT
    ga.document_id,
    ga.user_id,
    cp.percentage,
    MAX(ga.start_time) AS last_read,
    MAX(ga.created_at) AS last_seen,
    SUM(ga.total_read_percentage) AS read_percentage,

    -- All Time WPM
    SUM(ga.total_time_seconds) AS total_time_seconds,
    (CAST(COALESCE(d.words, 0.0) AS REAL) * SUM(ga.total_read_percentage))
        AS total_words_read,
    (CAST(COALESCE(d.words, 0.0) AS REAL) * SUM(ga.total_read_percentage))
    / (SUM(ga.total_time_seconds) / 60.0) AS total_wpm,

    -- Yearly WPM
    ga.yearly_time_seconds,
    CAST(COALESCE(d.words, 0.0) AS REAL) * ga.yearly_read_percentage
        AS yearly_words_read,
    COALESCE(
        (CAST(COALESCE(d.words, 0.0) AS REAL) * ga.yearly_read_percentage)
        / (ga.yearly_time_seconds / 60), 0.0)
        AS yearly_wpm,

    -- Monthly WPM
    ga.monthly_time_seconds,
    CAST(COALESCE(d.words, 0.0) AS REAL) * ga.monthly_read_percentage
        AS monthly_words_read,
    COALESCE(
        (CAST(COALESCE(d.words, 0.0) AS REAL) * ga.monthly_read_percentage)
        / (ga.monthly_time_seconds / 60), 0.0)
        AS monthly_wpm,

    -- Weekly WPM
    ga.weekly_time_seconds,
    CAST(COALESCE(d.words, 0.0) AS REAL) * ga.weekly_read_percentage
        AS weekly_words_read,
    COALESCE(
        (CAST(COALESCE(d.words, 0.0) AS REAL) * ga.weekly_read_percentage)
        / (ga.weekly_time_seconds / 60), 0.0)
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
