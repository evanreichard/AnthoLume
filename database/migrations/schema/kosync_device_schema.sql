CREATE TABLE IF NOT EXISTS kosync_device_aliases (
 user_id TEXT NOT NULL REFERENCES users(id),
 external_id TEXT NOT NULL,
 device_id TEXT NOT NULL REFERENCES devices(id),
 PRIMARY KEY(user_id, external_id)
);
CREATE TABLE IF NOT EXISTS reading_head_devices (
 user_id TEXT NOT NULL,
 document_id TEXT NOT NULL,
 external_id TEXT,
 device_name TEXT NOT NULL,
 PRIMARY KEY(user_id, document_id),
 FOREIGN KEY(user_id, document_id) REFERENCES reading_heads(user_id, document_id) ON DELETE CASCADE
);
CREATE TRIGGER IF NOT EXISTS kosync_alias_user_deleted BEFORE DELETE ON users BEGIN
 DELETE FROM kosync_device_aliases WHERE user_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS kosync_alias_device_deleted BEFORE DELETE ON devices BEGIN
 DELETE FROM kosync_device_aliases WHERE device_id=OLD.id;
END;
