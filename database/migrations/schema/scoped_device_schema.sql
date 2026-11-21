DROP TRIGGER kosync_alias_user_deleted;
DROP TRIGGER kosync_alias_device_deleted;
DROP TRIGGER user_deleted;
DROP TABLE kosync_device_aliases;
DROP TABLE reading_heads;
DROP TABLE device_preferences;
DROP TABLE document_progress;
DROP TABLE activity;
DROP TABLE devices;

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
