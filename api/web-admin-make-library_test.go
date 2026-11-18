package api

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMakeLibraryKeepsFilesAndBookLinks(t *testing.T) {
	for _, same := range []bool{false, true} {
		name := "swap"
		if same {
			name = "same folder"
		}
		t.Run(name, func(t *testing.T) {
			f := newWebFixture(t)
			f.register("owner")
			f.exec(`UPDATE users SET admin=1 WHERE id='owner'`)
			old := filepath.Join(f.cfg.DataPath, "documents")
			incoming := t.TempDir()
			if same {
				incoming = old
			}
			require.NoError(t, os.WriteFile(filepath.Join(old, "old.epub"), []byte("old contents"), 0600))
			require.NoError(t, os.WriteFile(filepath.Join(incoming, "new.epub"), []byte("new contents"), 0600))
			response := f.call("PUT", "/api/v1/admin/storage-roots", AdminStorageRootInput{Id: "incoming", Label: "Incoming", Path: incoming}, nil)
			require.Equal(t, 204, response.status, string(response.body))
			f.exec(`INSERT INTO documents(id,filepath,storage_root_id) VALUES('old-book','old.epub',NULL),('new-book','new.epub','incoming')`)
			f.exec(`INSERT INTO reading_heads(user_id,document_id,position,fraction) VALUES('owner','new-book','position',0.25)`)
			f.exec(`INSERT INTO auto_import_rules(id,name,root_id,enabled,watch,interval_minutes,reference) VALUES('abc','Test rule','incoming',1,0,15,1)`)
			path := "/api/v1/admin/storage-roots/make-library"
			response = f.call("GET", path+"?id=incoming", nil, nil)
			require.Equal(t, 200, response.status, string(response.body))
			plan := decodeWeb[MakeLibraryPlan](t, response)
			require.Equal(t, 1, plan.Incoming)
			require.Equal(t, 1, plan.PausedRules)
			require.Equal(t, same, plan.SameFolder)
			if same {
				require.Zero(t, plan.Outgoing)
			} else {
				require.Equal(t, 1, plan.Outgoing)
			}
			stale := plan
			stale.Incoming++
			assertProblem(t, f.call("POST", path, stale, nil), 409, "library_plan_changed")
			response = f.call("POST", path, plan, nil)
			require.Equal(t, 204, response.status, string(response.body))
			for id, body := range map[string]string{"old-book": "old contents", "new-book": "new contents"} {
				response = f.call("GET", "/api/v1/documents/"+id+"/file", nil, nil)
				require.Equal(t, 200, response.status)
				require.Equal(t, body, string(response.body))
			}
			var position string
			require.NoError(t, f.db.DB.QueryRow(`SELECT position FROM reading_heads WHERE document_id='new-book'`).Scan(&position))
			require.Equal(t, "position", position)
			var enabled bool
			require.NoError(t, f.db.DB.QueryRow(`SELECT enabled FROM auto_import_rules WHERE id='abc'`).Scan(&enabled))
			require.False(t, enabled)
			response = f.call("GET", "/api/v1/admin/backup/preview", nil, nil)
			require.Equal(t, 200, response.status)
			count := decodeWeb[AdminBackupPreview](t, response).Files
			if same {
				require.Equal(t, 2, count)
			} else {
				require.Equal(t, 1, count)
			}
		})
	}
}
