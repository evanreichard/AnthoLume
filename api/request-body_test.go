package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestBodyIdleDeadlineReleasesHandler(t *testing.T) {
	result := make(chan error, 1)
	server := httptest.NewServer(boundRequestBody(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := io.ReadAll(r.Body)
		result <- err
		w.WriteHeader(http.StatusRequestTimeout)
	}), 50*time.Millisecond))
	defer server.Close()
	body, writer := io.Pipe()
	defer writer.Close()
	transport := &http.Transport{}
	defer transport.CloseIdleConnections()
	req, err := http.NewRequest(http.MethodPost, server.URL, body)
	require.NoError(t, err)
	go func() {
		_, _ = writer.Write([]byte("incomplete fixture"))
	}()
	clientDone := make(chan struct{})
	go func() {
		defer close(clientDone)
		if response, err := transport.RoundTrip(req); err == nil {
			response.Body.Close()
		}
	}()
	defer func() {
		_ = writer.Close()
		<-clientDone
	}()
	select {
	case err := <-result:
		require.True(t, requestReadTimedOut(err), "%v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("incomplete request body did not time out")
	}
}
