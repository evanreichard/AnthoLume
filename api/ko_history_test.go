package api

import (
	"github.com/stretchr/testify/require"
	"reichard.io/antholume/database"
	"testing"
)

func TestRealKOHTTPDeterministicHistoricalTie(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	f.exec(`INSERT INTO devices(id,user_id,device_name) VALUES('device-b','alice','B'),('device-a','alice','A')`)
	f.exec(`INSERT INTO document_progress(user_id,document_id,device_id,percentage,progress,created_at) VALUES('alice','book-a','device-b',0.95,'B historical','2026-01-01T00:00:00Z'),('alice','book-a','device-a',0.15,'A historical exact','2026-01-01T00:00:00Z')`)
	f.exec(`INSERT INTO users(id,pass,auth_hash) VALUES('other-owner','synthetic','hash'); UPDATE devices SET user_id='other-owner' WHERE id='device-a'`)
	f.exec(`DELETE FROM goose_db_version WHERE version_id>=20261118000000`)
	f.server.Close()
	require.NoError(t, f.db.DB.Close())
	f.db = database.NewMgr(f.cfg)
	f.start()
	jar := f.client.Jar
	f.client.Jar = nil
	r := f.call("GET", "/api/ko/syncs/progress/book-a", nil, koHeaders())
	require.Equal(t, 200, r.status, string(r.body))
	require.Equal(t, "application/json", r.header.Get("Content-Type"))
	require.JSONEq(t, `{"document":"book-a","percentage":0.15,"progress":"A historical exact","device":"A","device_id":"device-a","timestamp":1767225600}`, string(r.body))
	require.Equal(t, int64(1767225600), decodeKOTimestamp(t, r))
	f.client.Jar = jar
	head := f.state()
	require.Equal(t, "0", head.Revision)
	require.Equal(t, "device-a", *head.DeviceId)
	require.Equal(t, "A historical exact", *head.Position)
	require.Equal(t, 0.15, *head.Fraction)
	r = f.koWrite("collision-placeholder", "device-a", 0.4, "new write must not take ownership")
	require.Equal(t, 200, r.status, string(r.body))
	require.Equal(t, 3, f.count("documents"))
	require.Equal(t, 3, f.count("document_progress"))
	var owner string
	require.NoError(t, f.db.DB.QueryRow("SELECT user_id FROM devices WHERE id='device-a'").Scan(&owner))
	require.Equal(t, "other-owner", owner)
	require.Zero(t, f.count("reading_receipts"))
}
