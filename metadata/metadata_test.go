package metadata

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGetMetadata(t *testing.T) {
	info, err := GetMetadata("../_test_files/alice.epub")
	require.NoError(t, err)
	require.Equal(t, TYPE_EPUB, info.Type)
	require.Equal(t, new("Alice's Adventures in Wonderland / Illustrated by Arthur Rackham. With a Proem by Austin Dobson"), info.Title)
	require.Equal(t, new("Lewis Carroll"), info.Author)
	require.Equal(t, new(""), info.Description)
	require.Equal(t, new(int64(30070)), info.WordCount)
}
