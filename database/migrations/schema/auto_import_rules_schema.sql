CREATE TABLE IF NOT EXISTS auto_import_rules (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 root_id TEXT NOT NULL REFERENCES storage_roots(id) ON DELETE CASCADE,
 enabled BOOLEAN NOT NULL CHECK(enabled IN (0,1)),
 watch BOOLEAN NOT NULL CHECK(watch IN (0,1)),
 interval_minutes INTEGER NOT NULL CHECK(interval_minutes BETWEEN 1 AND 1440),
 reference BOOLEAN NOT NULL CHECK(reference IN (0,1)),
 last_scan TEXT,
 next_scan TEXT,
 status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','complete','errors','unavailable'))
);
