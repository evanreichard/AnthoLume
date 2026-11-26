package api

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSyncNinjaDocumentInventory(t *testing.T) {
	f := newWebFixture(t)
	f.register("alice")
	f.exec(`INSERT INTO documents (id, filepath, deleted) VALUES ('book', 'book.epub', false), ('fileless', NULL, false), ('removed', 'removed.epub', true)`)
	sync := func(have []string) responseCheckDocumentSync {
		t.Helper()
		r := f.call("POST", "/api/ko/syncs/documents", requestCheckDocumentSync{DeviceID: "reader", Device: "Reader", Have: have}, koHeaders())
		require.Equal(t, 200, r.status, string(r.body))
		return decodeWeb[responseCheckDocumentSync](t, r)
	}
	empty := sync([]string{})
	require.Len(t, empty.Give, 1)
	require.Equal(t, "book", empty.Give[0].ID)
	require.Equal(t, []string{}, empty.Delete)
	require.Equal(t, []string{}, empty.WantFiles)
	require.Equal(t, []string{}, empty.WantMetadata)

	mixed := sync([]string{"book", "removed", "fileless", "unknown"})
	require.NotNil(t, mixed.Give)
	require.Empty(t, mixed.Give)
	require.Equal(t, []string{"removed"}, mixed.Delete)
	require.ElementsMatch(t, []string{"fileless", "unknown"}, mixed.WantFiles)
	require.Equal(t, []string{"unknown"}, mixed.WantMetadata)
}
