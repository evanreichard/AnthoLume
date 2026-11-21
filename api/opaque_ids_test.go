package api

import (
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOpaqueDocumentIDsSurvivePathEscaping(t *testing.T) {
	f := newWebFixture(t)
	f.readingSetup()
	for _, id := range []string{"opaque/with space+and%literal", strings.Repeat("é", 128)} {
		f.exec("INSERT INTO documents(id,title) VALUES(?,?)", id, "Opaque title")
		encoded := url.PathEscape(id)
		r := f.call("GET", "/api/v1/documents/"+encoded, nil, nil)
		require.Equal(t, 200, r.status, string(r.body))
		require.Equal(t, id, decodeWeb[Document](t, r).Id)
		event := progressPayload("0", 0.3)
		event["document_id"] = id
		require.Equal(t, 200, f.call("POST", "/api/v1/me/reading-progress", event, nil).status)
		r = f.call("GET", "/api/v1/me/reading-state/"+encoded, nil, nil)
		require.Equal(t, 200, r.status, string(r.body))
		require.Equal(t, id, decodeWeb[ReadingState](t, r).DocumentId)
		r = f.call("GET", "/api/ko/syncs/progress/"+encoded, nil, nil)
		require.Equal(t, 404, r.status, string(r.body))
	}
}
