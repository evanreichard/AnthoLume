INSERT INTO document_user_statistics
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
    WHERE
        document_id = ?
        AND user_id = ?
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
    MAX(start_time) AS last_read,
    SUM(duration) AS total_time_seconds,
    SUM(read_percentage) AS read_percentage,
    cp.percentage,

    (CAST(COALESCE(d.words, 0.0) AS REAL) * SUM(read_percentage))
        AS words_read,

    (CAST(COALESCE(d.words, 0.0) AS REAL) * SUM(read_percentage))
    / (SUM(duration) / 60.0) AS wpm
FROM grouped_activity AS ga
INNER JOIN
    current_progress AS cp
    ON ga.user_id = cp.user_id AND ga.document_id = cp.document_id
INNER JOIN
    documents AS d
    ON d.id = ga.document_id
GROUP BY ga.document_id, ga.user_id
ORDER BY wpm DESC;
