package database

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
)

func TestAccountIdentityBackfillAndUsernameReuse(t *testing.T) {
	dir := t.TempDir()
	db := NewMgr(&config.Config{DBType: "sqlite", DBName: "identities", ConfigPath: dir, DataPath: dir})
	defer func() { require.NoError(t, db.DB.Close()) }()
	exec := func(q string) {
		t.Helper()
		_, err := db.DB.Exec(q)
		require.NoError(t, err)
	}
	// Recreate the schema immediately before account identities were installed.
	exec(`DROP TRIGGER account_identity_created; DROP TRIGGER account_identity_deleted; DROP TABLE account_identities;
 DELETE FROM goose_db_version WHERE version_id=20261126000001;
 INSERT INTO users(id,pass,auth_hash) VALUES('alice','password','token'),('bob','password','token');`)
	identity := func(username string) string {
		t.Helper()
		var id string
		require.NoError(t, db.DB.QueryRow(`SELECT account_id FROM account_identities WHERE user_id=?`, username).Scan(&id))
		parsed, err := uuid.Parse(id)
		require.NoError(t, err)
		require.Equal(t, id, parsed.String())
		require.Equal(t, uuid.Version(4), parsed.Version())
		require.Equal(t, uuid.RFC4122, parsed.Variant())
		return id
	}
	require.NoError(t, db.Reload(context.Background()))
	original := identity("alice")
	require.NotEqual(t, original, identity("bob"))
	exec(`UPDATE users SET pass='different',auth_hash='new-token' WHERE id='alice'`)
	require.NoError(t, db.Reload(context.Background()))
	require.Equal(t, original, identity("alice"))
	_, err := db.DB.Exec(`UPDATE account_identities SET account_id='changed' WHERE user_id='alice'`)
	require.ErrorContains(t, err, "account identity is immutable")
	exec(`DELETE FROM users WHERE id='alice'; INSERT INTO users(id,pass,auth_hash) VALUES('alice','different','new-token')`)
	require.NotEqual(t, original, identity("alice"))
}
