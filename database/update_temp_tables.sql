DELETE FROM user_streaks;
INSERT INTO user_streaks SELECT * FROM view_user_streaks;
DELETE FROM document_user_statistics;
INSERT INTO document_user_statistics
SELECT *
FROM view_document_user_statistics;
