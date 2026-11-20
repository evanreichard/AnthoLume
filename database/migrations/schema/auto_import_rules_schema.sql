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
 status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','complete','errors','unavailable')),
 books_added INTEGER CHECK(books_added >= 0),
 source_total INTEGER CHECK(source_total >= 0),
 last_scan_trigger TEXT CHECK(last_scan_trigger IN ('on_change','scheduled','manual','initial')),
 next_scan_trigger TEXT CHECK(next_scan_trigger IN ('on_change','scheduled','manual','initial'))
);
