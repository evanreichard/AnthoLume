package database

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
)

func TestDocumentIdentifierMigration(t *testing.T) {
	for _, path := range []string{"startup", "staged restore"} {
		t.Run(path, func(t *testing.T) {
			ctx := context.Background()
			dir := t.TempDir()
			db := openPreReactDatabase(t, &config.Config{DBType: "sqlite", DBName: "document-identifiers", ConfigPath: dir, DataPath: dir})

			const gbid = " Volume_ID-1 "
			const olid = " /works/OL123W "
			_, err := db.DB.Exec(`INSERT INTO documents (id, gbid, olid, isbn10, isbn13) VALUES
				('identifier-first', ?, ?, '0140328726', '9780140328721'),
				('identifier-second', ?, ?, NULL, NULL),
				('identifier-blank', '   ', NULL, NULL, NULL),
				('identifier-null', NULL, '', NULL, NULL)`, gbid, olid, gbid, olid)
			require.NoError(t, err)

			switch path {
			case "startup":
				require.NoError(t, db.Reload(ctx))
			case "staged restore":
				require.NoError(t, MigrateRestore(ctx, db.DB, dir))
			}

			rows, err := db.DB.Query(`SELECT document_id, namespace, value FROM document_identifiers
				WHERE document_id IN ('identifier-first', 'identifier-second', 'identifier-blank', 'identifier-null')
				ORDER BY document_id, namespace`)
			require.NoError(t, err)
			defer rows.Close()
			type identifier struct{ documentID, namespace, value string }
			var got []identifier
			for rows.Next() {
				var id identifier
				require.NoError(t, rows.Scan(&id.documentID, &id.namespace, &id.value))
				got = append(got, id)
			}
			require.NoError(t, rows.Err())
			require.Equal(t, []identifier{
				{"identifier-first", "google_books_volume", gbid},
				{"identifier-first", "openlibrary", olid},
				{"identifier-second", "google_books_volume", gbid},
				{"identifier-second", "openlibrary", olid},
			}, got)

			var oldColumns int
			require.NoError(t, db.DB.QueryRow(`SELECT count(*) FROM pragma_table_info('documents') WHERE name IN ('gbid', 'olid')`).Scan(&oldColumns))
			require.Zero(t, oldColumns)
			var isbn10, isbn13 string
			require.NoError(t, db.DB.QueryRow(`SELECT isbn10, isbn13 FROM documents WHERE id = 'identifier-first'`).Scan(&isbn10, &isbn13))
			require.Equal(t, "0140328726", isbn10)
			require.Equal(t, "9780140328721", isbn13)
		})
	}
}
