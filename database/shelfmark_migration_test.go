package database

import (
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/config"
	dbmigrations "reichard.io/antholume/database/migrations"
)

func TestShelfmarkMigrationPreservesConduitBookRequests(t *testing.T) {
	ctx := t.Context()
	dir := t.TempDir()
	db := openPreReactDatabase(t, &config.Config{DBType: "sqlite", DBName: "shelfmark", ConfigPath: dir, DataPath: dir})
	provider, err := migrationProvider(db.DB)
	require.NoError(t, err)
	_, err = provider.UpTo(dbmigrations.WithRestoreStorageDataPath(ctx, dir), 20261126000006)
	require.NoError(t, err)
	_, err = db.DB.Exec(`INSERT INTO shelfmark_requests(provider, book_id, title, author, description, year, has_cover, username, requested_at, remote_id) VALUES
		('hardcover', '69589', 'The Time Machine', 'H. G. Wells', '', 1895, 1, 'alex', '2026-01-01T12:00:00Z', 81)`)
	require.NoError(t, err)

	require.NoError(t, MigrateRestore(ctx, db.DB, dir))
	var remoteID int64
	require.NoError(t, db.DB.QueryRow(`SELECT remote_id FROM legacy_shelfmark_requests WHERE provider = 'hardcover' AND book_id = '69589'`).Scan(&remoteID))
	require.EqualValues(t, 81, remoteID)
	queries := New(db.DB)
	rows, err := queries.ListShelfmarkRequests(ctx, 0)
	require.NoError(t, err)
	require.Empty(t, rows)
	count, err := queries.CountShelfmarkBookReleases(ctx, `[["hardcover", "69589"]]`)
	require.NoError(t, err)
	require.Empty(t, count)
}

func TestShelfmarkReleaseAuthorMigrationPreservesConduitHistory(t *testing.T) {
	ctx := t.Context()
	dir := t.TempDir()
	db := openPreReactDatabase(t, &config.Config{DBType: "sqlite", DBName: "shelfmark", ConfigPath: dir, DataPath: dir})
	provider, err := migrationProvider(db.DB)
	require.NoError(t, err)
	_, err = provider.UpTo(dbmigrations.WithRestoreStorageDataPath(ctx, dir), 20261126000007)
	require.NoError(t, err)
	_, err = db.DB.Exec(`INSERT INTO shelfmark_releases (source, source_id, release_key, release_title, format, size, language, indexer,
		provider, book_id, book_title, author, description, year, has_cover, username, requested_at, state)
		VALUES ('prowlarr', '1', 'key', 'Release', 'epub', '', '', '', 'hardcover', '1', 'Book', 'Catalog Author', '', 2026, 0, 'reader', '2026-01-01T12:00:00Z', 'queued')`)
	require.NoError(t, err)
	require.NoError(t, MigrateRestore(ctx, db.DB, dir))
	row, err := New(db.DB).GetShelfmarkReleaseBySource(ctx, GetShelfmarkReleaseBySourceParams{Source: "prowlarr", SourceID: "1"})
	require.NoError(t, err)
	require.Equal(t, "Catalog Author", row.Author)
	require.Empty(t, row.ReleaseAuthor)
	require.Equal(t, "queued", row.State)
}

func TestShelfmarkHistoryPaginatesBooksByMostRecentRelease(t *testing.T) {
	ctx := t.Context()
	dir := t.TempDir()
	db := openPreReactDatabase(t, &config.Config{DBType: "sqlite", DBName: "shelfmark", ConfigPath: dir, DataPath: dir})
	require.NoError(t, MigrateRestore(ctx, db.DB, dir))
	queries := New(db.DB)
	for i := range 53 {
		release := fmt.Sprintf("file-%d", i)
		_, err := queries.ClaimShelfmarkRelease(ctx, ClaimShelfmarkReleaseParams{
			Source: "prowlarr", SourceID: release, ReleaseKey: release,
			Provider: "hardcover", BookID: fmt.Sprint(i % 52), BookTitle: release, Username: "reader",
			RequestedAt: time.Unix(int64(i), 0).UTC().Format(time.RFC3339),
		})
		require.NoError(t, err)
	}
	_, err := queries.ClaimShelfmarkRelease(ctx, ClaimShelfmarkReleaseParams{
		Source: "prowlarr", SourceID: "file-52", ReleaseKey: "different-key",
		Provider: "openlibrary", BookID: "alias", Username: "another-reader",
	})
	require.ErrorIs(t, err, sql.ErrNoRows)
	first, err := queries.ListShelfmarkRequests(ctx, 0)
	require.NoError(t, err)
	require.Len(t, first, 51)
	require.Equal(t, "0", first[0].BookID)
	require.EqualValues(t, 2, first[0].RequestCount)
	require.Equal(t, "file-52", first[0].BookTitle)
	second, err := queries.ListShelfmarkRequests(ctx, 50)
	require.NoError(t, err)
	require.Len(t, second, 2)
	require.Equal(t, first[50], second[0])
	require.Equal(t, "1", second[1].BookID)
	counts, err := queries.CountShelfmarkBookReleases(ctx, `[["hardcover", "0"], ["hardcover", "0"], ["openlibrary", "0"]]`)
	require.NoError(t, err)
	require.Equal(t, []CountShelfmarkBookReleasesRow{{Provider: "hardcover", BookID: "0", RequestCount: 2}}, counts)
}
