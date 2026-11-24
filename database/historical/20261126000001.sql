CREATE TABLE users (
    id TEXT NOT NULL PRIMARY KEY,

    pass TEXT NOT NULL,
    auth_hash TEXT NOT NULL,
    admin BOOLEAN NOT NULL DEFAULT 0 CHECK (admin IN (0, 1)),
    timezone TEXT NOT NULL DEFAULT 'Europe/London',

    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE storage_roots (
    id TEXT NOT NULL PRIMARY KEY,
    label TEXT NOT NULL,
    path TEXT,
    managed BOOLEAN NOT NULL CHECK (managed IN (0, 1)),
    legacy_path TEXT
);

CREATE TABLE documents (
    id TEXT NOT NULL PRIMARY KEY,

    md5 TEXT,
    basepath TEXT,
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
    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
    storage_root_id TEXT REFERENCES storage_roots (id)
);

CREATE TABLE metadata (
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

CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    name TEXT NOT NULL,
    value TEXT NOT NULL,

    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE document_user_statistics (
    document_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    percentage REAL NOT NULL,
    last_read DATETIME NOT NULL,
    last_seen DATETIME NOT NULL,
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

CREATE TABLE user_streaks (
    user_id TEXT NOT NULL,
    window TEXT NOT NULL,

    max_streak INTEGER NOT NULL,
    max_streak_start_date TEXT NOT NULL,
    max_streak_end_date TEXT NOT NULL,

    current_streak INTEGER NOT NULL,
    current_streak_start_date TEXT NOT NULL,
    current_streak_end_date TEXT NOT NULL,

    last_timezone TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    last_record TEXT NOT NULL,
    last_calculated TEXT NOT NULL,

    UNIQUE(user_id, window) ON CONFLICT REPLACE
);

CREATE TRIGGER update_documents_updated_at
BEFORE UPDATE ON documents BEGIN
UPDATE documents
SET updated_at = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE id = old.id;
END;

CREATE TABLE reading_receipts (
 user_id TEXT NOT NULL REFERENCES users(id), event_id TEXT NOT NULL,
 document_id TEXT NOT NULL REFERENCES documents(id), kind TEXT NOT NULL,
 payload_version INTEGER NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL,
 observed_at TEXT NOT NULL, status INTEGER NOT NULL,
 revision TEXT, code TEXT NOT NULL, current_revision TEXT,
 PRIMARY KEY(user_id, event_id)
);

CREATE TRIGGER reading_user_deleted BEFORE DELETE ON users BEGIN
 DELETE FROM reading_receipts WHERE user_id=OLD.id;
 DELETE FROM reading_heads WHERE user_id=OLD.id;
END;

CREATE TRIGGER reading_document_deleted BEFORE DELETE ON documents BEGIN
 DELETE FROM reading_receipts WHERE document_id=OLD.id;
 DELETE FROM reading_heads WHERE document_id=OLD.id;
END;

CREATE TRIGGER reading_document_tombstoned AFTER UPDATE OF deleted ON documents
WHEN NEW.deleted=1 BEGIN
 DELETE FROM reading_receipts WHERE document_id=OLD.id;
 DELETE FROM reading_heads WHERE document_id=OLD.id;
END;

CREATE TABLE goose_db_version (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		version_id INTEGER NOT NULL,
		is_applied INTEGER NOT NULL,
		tstamp TIMESTAMP DEFAULT (datetime('now'))
	);

CREATE TABLE reading_head_devices (
 user_id TEXT NOT NULL,
 document_id TEXT NOT NULL,
 external_id TEXT,
 device_name TEXT NOT NULL,
 PRIMARY KEY(user_id, document_id),
 FOREIGN KEY(user_id, document_id) REFERENCES reading_heads(user_id, document_id) ON DELETE CASCADE
);

CREATE TABLE admin_jobs (
 id TEXT PRIMARY KEY NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('statistics','database_check','import')),
 status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted')),
 started_at TEXT NOT NULL,
 finished_at TEXT,
 deadline TEXT NOT NULL,
 result BLOB
);

CREATE UNIQUE INDEX admin_jobs_running ON admin_jobs(kind) WHERE status='running';

CREATE TABLE auto_import_rules (
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

CREATE TABLE account_identities (
 user_id TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL UNIQUE DEFAULT (lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' ||
  substr('89ab',1 + (random() & 3),1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))))
 );

CREATE TRIGGER account_identity_created AFTER INSERT ON users
 BEGIN INSERT INTO account_identities(user_id) VALUES (new.id); END;

CREATE TRIGGER account_identity_deleted AFTER DELETE ON users
 BEGIN DELETE FROM account_identities WHERE user_id=old.id; END;

CREATE TRIGGER account_identity_immutable BEFORE UPDATE ON account_identities
 BEGIN SELECT RAISE(ABORT,'account identity is immutable'); END;

CREATE TABLE reading_generation (
 singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton=1),
 generation TEXT NOT NULL CHECK (length(generation)=32 AND generation NOT GLOB '*[^0-9a-f]*')
 );

CREATE TABLE devices (
    id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    device_name TEXT NOT NULL,
    last_synced DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
    sync BOOLEAN NOT NULL DEFAULT 1 CHECK (sync IN (0, 1)),
    PRIMARY KEY (user_id, id)
);

CREATE TABLE document_progress (
    user_id TEXT NOT NULL REFERENCES users(id),
    document_id TEXT NOT NULL REFERENCES documents(id),
    device_id TEXT NOT NULL,
    percentage REAL NOT NULL,
    progress TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (user_id, device_id) REFERENCES devices(user_id, id),
    PRIMARY KEY (user_id, document_id, device_id)
);

CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    document_id TEXT NOT NULL REFERENCES documents(id),
    device_id TEXT NOT NULL,
    start_time DATETIME NOT NULL,
    start_percentage REAL NOT NULL,
    end_percentage REAL NOT NULL,
    duration INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (user_id, device_id) REFERENCES devices(user_id, id)
);

CREATE TABLE reading_heads (
    user_id TEXT NOT NULL REFERENCES users(id),
    document_id TEXT NOT NULL REFERENCES documents(id),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 999999999999999999),
    position TEXT, fraction REAL, device_id TEXT, updated_at TEXT,
    PRIMARY KEY (user_id, document_id),
    FOREIGN KEY (user_id, device_id) REFERENCES devices(user_id, id)
);

CREATE TABLE device_preferences (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    archived BOOLEAN NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    PRIMARY KEY (user_id, device_id),
    FOREIGN KEY (user_id, device_id) REFERENCES devices(user_id, id) ON DELETE CASCADE
);

CREATE TRIGGER user_deleted BEFORE DELETE ON users BEGIN
    DELETE FROM activity WHERE user_id=OLD.id;
    DELETE FROM document_progress WHERE user_id=OLD.id;
    DELETE FROM devices WHERE user_id=OLD.id;
END;

CREATE INDEX activity_start_time ON activity (start_time);

CREATE INDEX activity_created_at ON activity (created_at);

CREATE INDEX activity_user_id ON activity (user_id);

CREATE INDEX activity_user_id_document_id ON activity (user_id, document_id);

CREATE TRIGGER reading_progress_writer BEFORE INSERT ON document_progress BEGIN
 SELECT CASE WHEN READING_WRITER()!=1 THEN RAISE(ABORT,'reading writer required') END;
END;

CREATE TRIGGER reading_progress_update_writer BEFORE UPDATE ON document_progress BEGIN
 SELECT CASE WHEN READING_WRITER()!=1 THEN RAISE(ABORT,'reading writer required') END;
END;

CREATE TRIGGER reading_activity_writer BEFORE INSERT ON activity BEGIN
 SELECT CASE WHEN READING_WRITER()!=1 THEN RAISE(ABORT,'reading writer required') END;
END;

INSERT INTO goose_db_version(version_id,is_applied) VALUES (0,1),(20240128012356,1),(20240311121111,1),(20240510123707,1),(20261126000000,1),(20261126000001,1);
INSERT INTO storage_roots(id,label,managed) VALUES ('library','Library',1),('imports','Imports',0);
