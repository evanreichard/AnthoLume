CREATE TABLE IF NOT EXISTS admin_jobs (
 id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted')),
 started_at TEXT NOT NULL,
 finished_at TEXT,
 deadline TEXT NOT NULL
 );
 CREATE UNIQUE INDEX IF NOT EXISTS admin_jobs_running ON admin_jobs(kind) WHERE status='running';
