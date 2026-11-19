CREATE TABLE IF NOT EXISTS account_identities (
 user_id TEXT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL UNIQUE DEFAULT (lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' ||
  substr('89ab',1 + (random() & 3),1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))))
 );
 INSERT INTO account_identities(user_id) SELECT id FROM users
 WHERE NOT EXISTS (SELECT 1 FROM account_identities WHERE user_id=users.id);
 CREATE TRIGGER IF NOT EXISTS account_identity_created AFTER INSERT ON users
 BEGIN INSERT INTO account_identities(user_id) VALUES (new.id); END;
 CREATE TRIGGER IF NOT EXISTS account_identity_deleted AFTER DELETE ON users
 BEGIN DELETE FROM account_identities WHERE user_id=old.id; END;
 CREATE TRIGGER IF NOT EXISTS account_identity_immutable BEFORE UPDATE ON account_identities
 BEGIN SELECT RAISE(ABORT,'account identity is immutable'); END;
