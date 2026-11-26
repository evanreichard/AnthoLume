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

func TestShelfmarkMigrationFromMaster(t *testing.T) {
	ctx := t.Context()
	dir := t.TempDir()
	db := openPreReactDatabase(t, &config.Config{DBType: "sqlite", DBName: "shelfmark", ConfigPath: dir, DataPath: dir})
	provider, err := migrationProvider(db.DB)
	require.NoError(t, err)
	_, err = provider.UpTo(dbmigrations.WithRestoreStorageDataPath(ctx, dir), 20261126000005)
	require.NoError(t, err)
	require.NoError(t, MigrateRestore(ctx, db.DB, dir))
	queries := New(db.DB)
	rows, err := queries.ListShelfmarkRequests(ctx, 0)
	require.NoError(t, err)
	require.Empty(t, rows)

	var rawIDColumns int
	require.NoError(t, db.DB.QueryRow(`SELECT count(*) FROM pragma_table_info('shelfmark_releases') WHERE name='source_id'`).Scan(&rawIDColumns))
	require.Zero(t, rawIDColumns)
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
			Source: "prowlarr", ReleaseKey: release,
			Provider: "hardcover", BookID: fmt.Sprint(i % 52), BookTitle: release, Username: "reader",
			RequestedAt: time.Unix(int64(i), 0).UTC().Format(time.RFC3339),
		})
		require.NoError(t, err)
	}
	_, err := queries.ClaimShelfmarkRelease(ctx, ClaimShelfmarkReleaseParams{
		Source: "prowlarr", ReleaseKey: "file-52",
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
