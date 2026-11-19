CREATE TABLE IF NOT EXISTS device_preferences (
 device_id TEXT NOT NULL PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
 label TEXT NOT NULL,
 archived BOOLEAN NOT NULL CHECK (archived IN (0, 1))
);
