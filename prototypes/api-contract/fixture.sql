-- Fixture Scope - Core columns mirror database/schema.sql; migrations, triggers and derived tables are not modeled.
CREATE TABLE users (id TEXT PRIMARY KEY, pass TEXT NOT NULL, auth_hash TEXT NOT NULL, admin BOOLEAN NOT NULL DEFAULT 0);
CREATE TABLE documents (
 id TEXT PRIMARY KEY, md5 TEXT, basepath TEXT, filepath TEXT, coverfile TEXT,
 title TEXT, author TEXT, series TEXT, series_index INTEGER, lang TEXT, description TEXT,
 words INTEGER, gbid TEXT, olid TEXT, isbn10 TEXT, isbn13 TEXT,
 synced BOOLEAN NOT NULL DEFAULT 0, deleted BOOLEAN NOT NULL DEFAULT 0,
 updated_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ','now')),
 created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), device_name TEXT NOT NULL);
CREATE TABLE document_progress (
 user_id TEXT NOT NULL REFERENCES users(id), document_id TEXT NOT NULL REFERENCES documents(id),
 device_id TEXT NOT NULL REFERENCES devices(id), percentage REAL NOT NULL, progress TEXT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ','now')),
 PRIMARY KEY(user_id,document_id,device_id)
);
CREATE TABLE activity (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id),
 document_id TEXT NOT NULL REFERENCES documents(id), device_id TEXT NOT NULL REFERENCES devices(id),
 start_time DATETIME NOT NULL, start_percentage REAL NOT NULL, end_percentage REAL NOT NULL, duration INTEGER NOT NULL,
 created_at DATETIME NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE proof_heads (
 user_id TEXT NOT NULL REFERENCES users(id), document_id TEXT NOT NULL REFERENCES documents(id),
 revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,document_id)
);
CREATE TABLE proof_receipts (
 user_id TEXT NOT NULL REFERENCES users(id), event_id TEXT NOT NULL, digest TEXT NOT NULL,
 status INTEGER NOT NULL, body BLOB NOT NULL,
 received_at TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ','now')),
 PRIMARY KEY(user_id,event_id)
);
INSERT INTO users VALUES ('alice','not-a-credential','private-auth',0), ('bob','not-a-credential','private-auth',0), ('admin','not-a-credential','private-auth',1);
INSERT INTO devices VALUES ('a-device','alice','Alice'),('b-device','bob','Bob'),('a-second','alice','Second');
INSERT INTO documents(id,title,author,basepath,filepath) VALUES
 ('book-a',NULL,'Synthetic Author','/private/root','private.epub'),
 ('book-b','Second',NULL,'/private/root','private.epub'),
 ('deleted','Tombstone',NULL,NULL,NULL);
UPDATE documents SET deleted=1 WHERE id='deleted';
