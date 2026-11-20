package database

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
)

func TestListOPDSDocuments(t *testing.T) {
	ctx := context.Background()
	db := NewMgr(&config.Config{DBType: "memory"})
	t.Cleanup(func() { require.NoError(t, db.DB.Close()) })
	_, err := db.DB.Exec(`
		INSERT INTO users(id, pass, auth_hash) VALUES ('alice', '', ''), ('bob', '', '');
		INSERT INTO devices(id, user_id, device_name) VALUES ('a', 'alice', 'A'), ('b', 'bob', 'B');
		INSERT INTO documents(id, title, author, description, filepath, deleted, created_at) VALUES
			('fileless', 'Needle', NULL, NULL, NULL, 0, '2026-01-01T00:00:00Z'),
			('read', 'Book', 'Needle', 'Summary', 'read.epub', 0, '2026-01-02T00:00:00Z'),
			('new', NULL, NULL, NULL, 'new.epub', 0, '2026-01-04T00:00:00Z'),
			('other-user', 'Needle', NULL, NULL, 'other.epub', 0, '2026-01-03T00:00:00Z'),
			('deleted', 'Needle', NULL, NULL, 'deleted.epub', 1, '2026-01-05T00:00:00Z');
		INSERT INTO activity(user_id, document_id, device_id, start_time, duration, start_percentage, end_percentage) VALUES
			('alice', 'read', 'a', '2026-02-01T00:00:00Z', 60, 0, 0.1),
			('alice', 'fileless', 'a', '2026-02-02T00:00:00Z', 60, 0, 0.1),
			('bob', 'other-user', 'b', '2026-02-03T00:00:00Z', 60, 0, 0.1);
	`)
	require.NoError(t, err)
	require.NoError(t, db.CacheTempTables(ctx))

	ids := func(rows []ListOPDSDocumentsRow) []string {
		var result []string
		for _, row := range rows {
			result = append(result, row.ID)
		}
		return result
	}
	rows, err := db.Queries.ListOPDSDocuments(ctx, ListOPDSDocumentsParams{UserID: "alice", Limit: 10})
	require.NoError(t, err)
	require.Equal(t, []string{"fileless", "read", "new", "other-user"}, ids(rows))
	require.Nil(t, rows[0].Filepath)
	rows, err = db.Queries.ListOPDSDocuments(ctx, ListOPDSDocumentsParams{UserID: "bob", Limit: 10})
	require.NoError(t, err)
	require.Equal(t, []string{"other-user", "new", "read", "fileless"}, ids(rows))

	query := "%needle%"
	rows, err = db.Queries.ListOPDSDocuments(ctx, ListOPDSDocumentsParams{UserID: "alice", Query: &query, Limit: 10})
	require.NoError(t, err)
	require.Equal(t, []string{"fileless", "read", "other-user"}, ids(rows))
	page, err := db.Queries.ListOPDSDocuments(ctx, ListOPDSDocumentsParams{UserID: "alice", Query: &query, Limit: 1, Offset: 1})
	require.NoError(t, err)
	require.Equal(t, rows[1:2], page)
	require.Equal(t, "Book", *page[0].Title)
	require.Equal(t, "Needle", *page[0].Author)
	require.Equal(t, "Summary", *page[0].Description)
	require.Equal(t, "read.epub", *page[0].Filepath)
}
