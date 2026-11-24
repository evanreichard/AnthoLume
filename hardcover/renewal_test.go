package hardcover

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUnauthorizedShelfRenewsBeforeExpiry(t *testing.T) {
	var refreshes atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/token" {
			checkBasic(t, r)
			if r.PostForm.Get("grant_type") == "authorization_code" {
				sendTokens(w, "old", 3600)
				return
			}
			assert.Equal(t, "hc_rt_old", r.PostForm.Get("refresh_token"))
			refreshes.Add(1)
			sendTokens(w, "new", 3600)
			return
		}
		var req struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if strings.Contains(req.Query, "AnthoLumeProfile") {
			sendProfile(w, 10, "unchanged-reader")
			return
		}
		if r.Header.Get("Authorization") == "Bearer hc_at_old" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		assert.Equal(t, "Bearer hc_at_new", r.Header.Get("Authorization"))
		_, _ = w.Write([]byte(`{"data":{"user_books":[]}}`))
	}))
	defer upstream.Close()
	ctx := context.Background()
	c := testClient(t, filepath.Join(t.TempDir(), "links"), upstream.URL)
	require.NoError(t, c.Connect(ctx, "account", "code", testVerifier))
	_, err := c.Shelf(ctx, "account", 0)
	require.NoError(t, err)
	require.EqualValues(t, 1, refreshes.Load())
}

func TestFreshTokenRejectionRequiresReconnectWithoutRetryingRotation(t *testing.T) {
	var refreshes, reads atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/token" {
			checkBasic(t, r)
			if r.PostForm.Get("grant_type") == "authorization_code" {
				sendTokens(w, r.PostForm.Get("code"), 3600)
				return
			}
			assert.Equal(t, "hc_rt_first", r.PostForm.Get("refresh_token"))
			refreshes.Add(1)
			sendTokens(w, "replacement", 3600)
			return
		}
		var req struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if strings.Contains(req.Query, "AnthoLumeProfile") {
			sendProfile(w, 10, "reader")
			return
		}
		switch reads.Add(1) {
		case 1:
			w.WriteHeader(http.StatusServiceUnavailable)
		case 2:
			assert.Equal(t, "Bearer hc_at_first", r.Header.Get("Authorization"))
			w.WriteHeader(http.StatusUnauthorized)
		case 3:
			assert.Equal(t, "Bearer hc_at_replacement", r.Header.Get("Authorization"))
			w.WriteHeader(http.StatusUnauthorized)
		default:
			assert.Equal(t, "Bearer hc_at_reconnected", r.Header.Get("Authorization"))
			_, _ = w.Write([]byte(`{"data":{"user_books":[]}}`))
		}
	}))
	defer upstream.Close()
	ctx := context.Background()
	dir := filepath.Join(t.TempDir(), "links")
	c := testClient(t, dir, upstream.URL)
	require.NoError(t, c.Connect(ctx, "account", "first", testVerifier))
	_, err := c.Shelf(ctx, "account", 0)
	require.ErrorIs(t, err, ErrProvider)
	_, err = c.Status("account")
	require.NoError(t, err)
	require.Zero(t, refreshes.Load())

	_, err = c.Shelf(ctx, "account", 0)
	require.ErrorIs(t, err, ErrReconnect)
	c = testClient(t, dir, upstream.URL)
	username, err := c.Status("account")
	require.Equal(t, "reader", username)
	require.ErrorIs(t, err, ErrReconnect)
	_, err = c.Shelf(ctx, "account", 0)
	require.ErrorIs(t, err, ErrReconnect)
	require.EqualValues(t, 1, refreshes.Load())
	require.EqualValues(t, 3, reads.Load())

	require.NoError(t, c.Connect(ctx, "account", "reconnected", testVerifier))
	_, err = c.Status("account")
	require.NoError(t, err)
	_, err = c.Shelf(ctx, "account", 0)
	require.NoError(t, err)
}

func TestDifferentHardcoverIdentityNeedsExplicitDisconnect(t *testing.T) {
	var revocations atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth2/token":
			checkBasic(t, r)
			sendTokens(w, r.PostForm.Get("code"), 3600)
		case "/v1/graphql":
			if r.Header.Get("Authorization") == "Bearer hc_at_different" {
				sendProfile(w, 2, "different-reader")
				return
			}
			sendProfile(w, 1, "first-reader")
		case "/oauth2/revoke":
			checkBasic(t, r)
			token := r.PostForm.Get("token")
			if revocations.Add(1) == 1 {
				assert.Equal(t, "hc_rt_different", token)
			} else {
				assert.Equal(t, "hc_rt_first", token)
			}
			w.WriteHeader(http.StatusNoContent)
		}
	}))
	defer upstream.Close()
	ctx := context.Background()
	c := testClient(t, filepath.Join(t.TempDir(), "links"), upstream.URL)
	require.NoError(t, c.Connect(ctx, "account", "first", testVerifier))
	require.ErrorIs(t, c.Connect(ctx, "account", "different", testVerifier), ErrIdentity)
	username, err := c.Status("account")
	require.NoError(t, err)
	require.Equal(t, "first-reader", username)
	require.NoError(t, c.Disconnect(ctx, "account"))
	require.NoError(t, c.Connect(ctx, "account", "different", testVerifier))
	username, err = c.Status("account")
	require.NoError(t, err)
	require.Equal(t, "different-reader", username)
	require.EqualValues(t, 2, revocations.Load())
}
