CREATE TABLE IF NOT EXISTS reading_heads (
 user_id TEXT NOT NULL REFERENCES users(id),
 document_id TEXT NOT NULL REFERENCES documents(id),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 999999999999999999),
 position TEXT, fraction REAL, device_id TEXT, updated_at TEXT,
 PRIMARY KEY(user_id, document_id)
);
CREATE TABLE IF NOT EXISTS reading_receipts (
 user_id TEXT NOT NULL REFERENCES users(id), event_id TEXT NOT NULL,
 document_id TEXT NOT NULL REFERENCES documents(id), kind TEXT NOT NULL,
 payload_version INTEGER NOT NULL, payload TEXT NOT NULL, digest TEXT NOT NULL,
 observed_at TEXT NOT NULL, status INTEGER NOT NULL,
 revision TEXT, code TEXT NOT NULL, current_revision TEXT,
 PRIMARY KEY(user_id, event_id)
);
CREATE TRIGGER IF NOT EXISTS reading_user_deleted BEFORE DELETE ON users BEGIN
 DELETE FROM reading_receipts WHERE user_id=OLD.id;
 DELETE FROM reading_heads WHERE user_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS reading_document_deleted BEFORE DELETE ON documents BEGIN
 DELETE FROM reading_receipts WHERE document_id=OLD.id;
 DELETE FROM reading_heads WHERE document_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS reading_document_tombstoned AFTER UPDATE OF deleted ON documents
WHEN NEW.deleted=1 BEGIN
 DELETE FROM reading_receipts WHERE document_id=OLD.id;
 DELETE FROM reading_heads WHERE document_id=OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS reading_progress_writer BEFORE INSERT ON document_progress BEGIN
 SELECT CASE WHEN READING_WRITER()!=1 THEN RAISE(ABORT,'reading writer required') END;
END;
CREATE TRIGGER IF NOT EXISTS reading_progress_update_writer BEFORE UPDATE ON document_progress BEGIN
 SELECT CASE WHEN READING_WRITER()!=1 THEN RAISE(ABORT,'reading writer required') END;
END;
CREATE TRIGGER IF NOT EXISTS reading_activity_writer BEFORE INSERT ON activity BEGIN
 SELECT CASE WHEN READING_WRITER()!=1 THEN RAISE(ABORT,'reading writer required') END;
END;
