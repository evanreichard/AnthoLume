package api

import (
	"bytes"
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRestoreMigratesPreviouslyGlobalDevices(t *testing.T) {
	ctx := context.Background()
	name, old := copyPreReactBackup(t)
	upgradeTestBackupTo(t, old, 20261126000000)
	_, err := old.Exec(`INSERT INTO users(id,pass,auth_hash,admin) VALUES ('alice','pass','alice',1),('bob','pass','bob',0);
INSERT INTO documents(id) VALUES('book');
INSERT INTO devices(id,user_id,device_name) VALUES ('reader','alice','Alice reader'),('bob-alias','bob','Bob reader');
INSERT INTO kosync_device_aliases VALUES ('bob','reader','bob-alias');
INSERT INTO device_preferences(device_id,label,archived) VALUES ('bob-alias','Bob label',0);
INSERT INTO activity(user_id,document_id,device_id,start_time,duration,start_percentage,end_percentage) VALUES
 ('bob','book','reader','2026-01-01T00:00:00Z',30,0,.1),('bob','book','bob-alias','2026-01-02T00:00:00Z',60,.1,.2);
INSERT INTO document_progress(user_id,document_id,device_id,percentage,progress) VALUES ('bob','book','bob-alias',.2,'position');
INSERT INTO reading_heads VALUES ('bob','book',4,'position',.2,'bob-alias','2026-01-02T00:00:00Z');
INSERT INTO reading_head_devices VALUES ('bob','book','reader','Reported at write');`)
	require.NoError(t, err)
	require.NoError(t, old.Close())
	payload, err := os.ReadFile(name)
	require.NoError(t, err)
	f := newWebFixture(t)
	require.NoError(t, f.api.RestoreFreshInstance(ctx, bytes.NewReader(payload)))
	cursor, err := f.api.reading.KOLastActivity(ctx, "bob", "reader", "Bob reader")
	require.NoError(t, err)
	require.EqualValues(t, 1767312000, cursor)
	var rows, duration int
	require.NoError(t, f.db.DB.QueryRow(`SELECT count(*), sum(duration) FROM activity WHERE user_id='bob' AND device_id='reader'`).Scan(&rows, &duration))
	require.Equal(t, 2, rows)
	require.Equal(t, 90, duration)
	var device, label, position, reported string
	require.NoError(t, f.db.DB.QueryRow(`SELECT h.device_id,p.label,h.position,s.device_name FROM reading_heads h JOIN device_preferences p ON p.user_id=h.user_id AND p.device_id=h.device_id JOIN reading_head_devices s ON s.user_id=h.user_id AND s.document_id=h.document_id WHERE h.user_id='bob'`).Scan(&device, &label, &position, &reported))
	require.Equal(t, []string{"reader", "Bob label", "position", "Reported at write"}, []string{device, label, position, reported})
	_, err = f.db.DB.Exec(`INSERT INTO document_progress(user_id,document_id,device_id,percentage,progress) VALUES ('alice','book','missing',0,'invalid')`)
	require.ErrorContains(t, err, "FOREIGN KEY constraint failed")
	require.NoError(t, f.api.reading.RegisterDevice(ctx, "alice", "alice-only", "Alice only"))
	_, err = f.db.DB.Exec(`INSERT INTO activity(user_id,document_id,device_id,start_time,duration,start_percentage,end_percentage) VALUES ('bob','book','alice-only','2026-01-01T00:00:00Z',30,0,.1)`)
	require.ErrorContains(t, err, "FOREIGN KEY constraint failed")
}
