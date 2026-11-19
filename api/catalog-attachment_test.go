package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"reichard.io/antholume/metadata"
)

func TestCatalogIngestAttachesKOReaderPlaceholder(t *testing.T) {
	for _, mode := range []string{"upload", "import copy", "import reference"} {
		t.Run(mode, func(t *testing.T) {
			f := newWebFixture(t)
			f.register("alice")
			const fixture = "../_test_files/alice.epub"
			book, err := os.ReadFile(fixture)
			require.NoError(t, err)
			meta, err := metadata.GetMetadata(fixture)
			require.NoError(t, err)
			id := *meta.PartialMD5
			require.Equal(t, 200, f.koWrite(id, "ko-device", .4, "original position").status)
			f.exec(`UPDATE documents SET title='Edited title',description='' WHERE id=?`, id)

			library := filepath.Join(f.cfg.DataPath, "documents")
			if mode == "upload" {
				upload := func() webResponse {
					return f.call("POST", "/api/v1/documents", string(book), map[string]string{"Content-Type": "application/epub+zip"})
				}
				for range 2 {
					response := upload()
					require.Equal(t, 200, response.status, string(response.body))
					doc := decodeWeb[Document](t, response)
					require.Equal(t, id, doc.Id)
					require.True(t, doc.FileAvailable)
				}
			} else {
				source := t.TempDir()
				require.NoError(t, os.WriteFile(filepath.Join(source, "alice.epub"), book, 0600))
				response := f.call("PUT", "/api/v1/admin/storage-roots", AdminStorageRootInput{Id: "source", Label: "Source", Path: source}, nil)
				require.Equal(t, 204, response.status, string(response.body))
				for _, want := range []AdminImportResultStatus{"imported", "skipped"} {
					results, err := f.api.importBooks(context.Background(), "source", mode == "import reference", false, nil)
					require.NoError(t, err)
					require.Equal(t, []AdminImportResult{{File: "alice.epub", Status: want}}, results)
				}
			}

			response := f.call("GET", "/api/v1/documents/"+id+"/file", nil, nil)
			require.Equal(t, 200, response.status)
			require.Equal(t, book, response.body)
			var title, description, fullHash, position, storage string
			var author *string
			require.NoError(t, f.db.DB.QueryRow(`SELECT title,description,author,md5,storage_root_id FROM documents WHERE id=?`, id).Scan(&title, &description, &author, &fullHash, &storage))
			require.Equal(t, "Edited title", title)
			require.Empty(t, description)
			require.Equal(t, meta.Author, author)
			require.Equal(t, *meta.MD5, fullHash)
			require.NoError(t, f.db.DB.QueryRow(`SELECT position FROM reading_heads WHERE document_id=? AND user_id='alice'`, id).Scan(&position))
			require.Equal(t, "original position", position)
			entries, err := os.ReadDir(library)
			require.NoError(t, err)
			if mode == "import reference" {
				require.Equal(t, "source", storage)
				require.Empty(t, entries)
			} else {
				require.Equal(t, libraryRoot, storage)
				require.Len(t, entries, 1)
			}
		})
	}
}

func TestUploadDoesNotReviveOrOverwriteCatalogBook(t *testing.T) {
	book, err := os.ReadFile("../_test_files/alice.epub")
	require.NoError(t, err)
	meta, err := metadata.GetMetadata("../_test_files/alice.epub")
	require.NoError(t, err)
	for _, state := range []struct {
		name    string
		path    *string
		deleted bool
	}{
		{name: "tombstone", deleted: true},
		{name: "known different hash"},
		{name: "attached with different hash", path: new(string)},
	} {
		t.Run(state.name, func(t *testing.T) {
			f := newWebFixture(t)
			f.register("reader")
			library := filepath.Join(f.cfg.DataPath, "documents")
			if state.path != nil {
				*state.path = "original.epub"
				require.NoError(t, os.WriteFile(filepath.Join(library, *state.path), []byte("original"), 0600))
			}
			existingHash := "different"
			if state.deleted {
				existingHash = *meta.MD5
			}
			f.exec(`INSERT INTO documents(id,md5,filepath,deleted,storage_root_id) VALUES(?,?,?,?,'library')`, *meta.PartialMD5, existingHash, state.path, state.deleted)
			response := f.call("POST", "/api/v1/documents", string(book), map[string]string{"Content-Type": "application/epub+zip"})
			assertProblem(t, response, 409, "conflict")
			var hash string
			var path *string
			var deleted bool
			require.NoError(t, f.db.DB.QueryRow(`SELECT md5,filepath,deleted FROM documents WHERE id=?`, *meta.PartialMD5).Scan(&hash, &path, &deleted))
			require.Equal(t, existingHash, hash)
			require.Equal(t, state.path, path)
			require.Equal(t, state.deleted, deleted)
			entries, err := os.ReadDir(library)
			require.NoError(t, err)
			if state.path == nil {
				require.Empty(t, entries)
			} else {
				require.Len(t, entries, 1)
				original, err := os.ReadFile(filepath.Join(library, *state.path))
				require.NoError(t, err)
				require.Equal(t, "original", string(original))
			}
		})
	}
}
