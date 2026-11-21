package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDownloadsKeepBookAndRootTogetherDuringLibrarySwitches(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	old, incoming := t.TempDir(), t.TempDir()
	for dir, body := range map[string]string{old: "old contents", incoming: "incoming contents"} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, "same.epub"), []byte(body), 0600))
	}
	f.exec(`UPDATE storage_roots SET path=? WHERE id='library'`, old)
	f.exec(`INSERT INTO storage_roots(id,label,path,managed) VALUES('other','Other',?,0)`, incoming)
	f.exec(`INSERT INTO documents(id,filepath,storage_root_id) VALUES('old-book','same.epub','library')`)

	// Move the row and rebind the root in separate statements, as Make Library does.
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		for flip := 0; ctx.Err() == nil; flip++ {
			err := func() error {
				tx, err := f.db.DB.BeginTx(ctx, nil)
				if err != nil {
					return err
				}
				defer tx.Rollback()
				bookRoot, libraryPath, otherPath := "other", incoming, old
				if flip%2 != 0 {
					bookRoot, libraryPath, otherPath = "library", old, incoming
				}
				if _, err := tx.ExecContext(ctx, `UPDATE documents SET storage_root_id=? WHERE id='old-book'`, bookRoot); err != nil {
					return err
				}
				if _, err := tx.ExecContext(ctx, `UPDATE storage_roots SET path=CASE id WHEN 'library' THEN ? ELSE ? END WHERE id IN ('library','other')`, libraryPath, otherPath); err != nil {
					return err
				}
				return tx.Commit()
			}()
			if err != nil && ctx.Err() == nil {
				done <- err
				return
			}
		}
		done <- nil
	}()
	defer func() { cancel(); require.NoError(t, <-done) }()

	for range 24 {
		for _, route := range []string{"/api/v1", "/api/ko"} {
			response := f.call("GET", route+"/documents/old-book/file", nil, koHeaders())
			require.Equal(t, 200, response.status, string(response.body))
			require.Equal(t, "old contents", string(response.body), route)
		}
	}
}

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
			incomingName := "old.epub"
			if same {
				incomingName = "new.epub"
			}
			require.NoError(t, os.WriteFile(filepath.Join(old, "old.epub"), []byte("old contents"), 0600))
			require.NoError(t, os.WriteFile(filepath.Join(incoming, incomingName), []byte("new contents"), 0600))
			response := f.call("PUT", "/api/v1/admin/storage-roots", AdminStorageRootInput{Id: "incoming", Label: "Incoming", Path: incoming}, nil)
			require.Equal(t, 204, response.status, string(response.body))
			f.exec(`INSERT INTO documents(id,filepath,storage_root_id) VALUES('old-book','old.epub',NULL),('new-book',?,'incoming')`, incomingName)
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
