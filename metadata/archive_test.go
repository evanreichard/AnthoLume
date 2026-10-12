package metadata

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type archiveEntry struct {
	name string
	data string
}

func writeTestArchive(t *testing.T, entries []archiveEntry) string {
	t.Helper()
	var data bytes.Buffer
	z := zip.NewWriter(&data)
	for _, entry := range entries {
		w, err := z.Create(entry.name)
		require.NoError(t, err)
		_, err = io.WriteString(w, entry.data)
		require.NoError(t, err)
	}
	require.NoError(t, z.Close())
	path := filepath.Join(t.TempDir(), "book")
	require.NoError(t, os.WriteFile(path, data.Bytes(), 0600))
	return path
}

func testEPUBEntries() []archiveEntry {
	return []archiveEntry{
		{"META-INF/container.xml", `<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`},
		{"content.opf", `<package><metadata><title>Test book</title><creator>Test author</creator></metadata><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>`},
		{"chapter.xhtml", `<html><body>one two three</body></html>`},
		{"mimetype", "application/epub+zip"},
	}
}

func TestEPUBMimetypeAnywhere(t *testing.T) {
	path := writeTestArchive(t, testEPUBEntries())
	info, err := GetMetadata(path)
	require.NoError(t, err)
	require.Equal(t, "Test book", *info.Title)
	require.EqualValues(t, 3, *info.WordCount)
	docType, err := GetDocumentType(path)
	require.NoError(t, err)
	require.Equal(t, TYPE_EPUB, *docType)
	f, err := os.Open(path)
	require.NoError(t, err)
	defer f.Close()
	docType, err = GetDocumentTypeReader(f)
	require.NoError(t, err)
	require.Equal(t, TYPE_EPUB, *docType)
	count, err := GetWordCount(path)
	require.NoError(t, err)
	require.EqualValues(t, 3, *count)
}

func TestUnsupportedArchive(t *testing.T) {
	for _, entries := range [][]archiveEntry{
		{{"book.txt", "not an EPUB"}},
		{{"mimetype", "application/not-epub"}},
	} {
		_, err := GetMetadata(writeTestArchive(t, entries))
		require.ErrorIs(t, err, ErrUnsupportedFileType)
	}
	_, err := GetDocumentTypeReader(strings.NewReader("plain text"))
	require.ErrorIs(t, err, ErrUnsupportedFileType)
}

func TestMalformedEPUB(t *testing.T) {
	for _, entries := range [][]archiveEntry{
		{{"mimetype", "application/epub+zip"}},
		{{"mimetype", "application/epub+zip"}, {"META-INF/container.xml", "invalid XML"}},
		{{"mimetype", "application/epub+zip"}, {"META-INF/container.xml", `<container/>`}},
		{{"mimetype", "application/epub+zip"}, {"META-INF/container.xml", `<container><rootfiles><rootfile full-path="missing.opf"/></rootfiles></container>`}},
		{{"mimetype", "application/epub+zip"}, {"mimetype", "application/epub+zip"}},
	} {
		_, err := GetMetadata(writeTestArchive(t, entries))
		require.ErrorIs(t, err, ErrInvalidDocument)
	}
	entries := testEPUBEntries()
	entries[1].data = "invalid OPF"
	_, err := GetMetadata(writeTestArchive(t, entries))
	require.ErrorIs(t, err, ErrInvalidDocument)
	entries = testEPUBEntries()
	entries[2].name = "missing.xhtml"
	_, err = GetMetadata(writeTestArchive(t, entries))
	require.ErrorIs(t, err, ErrInvalidDocument)
}

func TestArchiveBombLimits(t *testing.T) {
	entries := append(testEPUBEntries(), archiveEntry{"bomb", strings.Repeat("0", 2<<20)})
	_, err := GetMetadata(writeTestArchive(t, entries))
	require.ErrorIs(t, err, ErrArchiveTooLarge)

	for _, size := range []uint64{maxArchiveEntrySize + 1, ^uint64(0)} {
		z := &zip.Reader{File: []*zip.File{{FileHeader: zip.FileHeader{
			Name: "bomb", UncompressedSize64: size, CompressedSize64: 1,
		}}}}
		require.ErrorIs(t, checkArchiveLimits(z), ErrArchiveTooLarge)
	}
	z := &zip.Reader{}
	for i := 0; i < 5; i++ {
		z.File = append(z.File, &zip.File{FileHeader: zip.FileHeader{
			Name: strings.Repeat("x", i+1), UncompressedSize64: maxArchiveEntrySize, CompressedSize64: maxArchiveEntrySize,
		}})
	}
	require.ErrorIs(t, checkArchiveLimits(z), ErrArchiveTooLarge)
	z.File = make([]*zip.File, maxArchiveEntries+1)
	require.ErrorIs(t, checkArchiveLimits(z), ErrArchiveTooLarge)
}

func TestZIPDirectoryLimit(t *testing.T) {
	entries := make([]archiveEntry, maxArchiveEntries+1)
	for i := range entries {
		entries[i] = archiveEntry{fmt.Sprintf("entry-%d", i), ""}
	}
	path := writeTestArchive(t, entries)
	_, err := GetMetadata(path)
	require.ErrorIs(t, err, ErrArchiveTooLarge)
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	pos := bytes.LastIndex(data, []byte("PK\x05\x06"))
	require.NotEqual(t, -1, pos)
	binary.LittleEndian.PutUint16(data[pos+10:pos+12], 1)
	require.NoError(t, os.WriteFile(path, data, 0600))
	_, err = GetMetadata(path)
	require.ErrorIs(t, err, ErrArchiveTooLarge)
}

func TestDocumentSizeLimit(t *testing.T) {
	f, err := os.Create(filepath.Join(t.TempDir(), "oversized.epub"))
	require.NoError(t, err)
	defer f.Close()
	require.NoError(t, f.Truncate(MaxDocumentSize+1))
	_, err = GetMetadata(f.Name())
	require.ErrorIs(t, err, ErrArchiveTooLarge)
	_, err = GetDocumentTypeReader(f)
	require.ErrorIs(t, err, ErrArchiveTooLarge)
}

func TestForgedZIPSize(t *testing.T) {
	path := writeTestArchive(t, testEPUBEntries())
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	pos := bytes.Index(data, []byte("PK\x01\x02"))
	require.NotEqual(t, -1, pos)
	binary.LittleEndian.PutUint32(data[pos+24:pos+28], 1)
	require.NoError(t, os.WriteFile(path, data, 0600))
	_, err = GetMetadata(path)
	require.True(t, errors.Is(err, ErrInvalidDocument), "%v", err)
}
