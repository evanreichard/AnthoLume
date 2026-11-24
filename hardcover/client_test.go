package hardcover

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testClientID = "fixture-client"
	testSecret   = "fixture-secret"
	testCallback = "https://books.example.org/oauth/hardcover/callback"
	testVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
)

func testClient(t *testing.T, dir, upstream string) *Client {
	t.Helper()
	client, err := New(dir, testClientID, testSecret, testCallback)
	require.NoError(t, err)
	client.token, client.graphql, client.revoke = upstream+"/oauth2/token", upstream+"/v1/graphql", upstream+"/oauth2/revoke"
	return client
}

func checkBasic(t *testing.T, r *http.Request) {
	assert.Equal(t, http.MethodPost, r.Method)
	assert.Equal(t, "application/x-www-form-urlencoded", r.Header.Get("Content-Type"))
	id, secret, ok := r.BasicAuth()
	assert.True(t, ok)
	assert.True(t, id == testClientID && secret == testSecret)
	assert.NoError(t, r.ParseForm())
}

func sendTokens(w http.ResponseWriter, pair string, seconds int) {
	_ = json.NewEncoder(w).Encode(map[string]any{
		"access_token": "hc_at_" + pair, "refresh_token": "hc_rt_" + pair, "expires_in": seconds, "token_type": "Bearer",
	})
}

func sendProfile(w http.ResponseWriter, id int, username string) {
	_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"me": []any{map[string]any{"id": id, "username": username}}}})
}

func TestAuthorizeURLUsesConfidentialReadOnlyPKCEContract(t *testing.T) {
	c := testClient(t, filepath.Join(t.TempDir(), "links"), "")
	got, err := url.Parse(c.AuthorizeURL("state +/= value", testVerifier))
	require.NoError(t, err)
	require.Equal(t, "https://hardcover.app/oauth2/authorize", got.Scheme+"://"+got.Host+got.Path)
	require.Equal(t, url.Values{
		"client_id": {testClientID}, "redirect_uri": {testCallback}, "response_type": {"code"},
		"code_challenge_method": {"S256"}, "code_challenge": {"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"},
		"state": {"state +/= value"}, "scope": {"read:me:content read:library"},
	}, got.Query())
	require.Empty(t, c.AuthorizeURL("", testVerifier))
	require.Empty(t, c.AuthorizeURL("state", strings.Repeat("+", 43)))
	_, err = New(filepath.Join(t.TempDir(), "insecure"), testClientID, testSecret, "http://books.example.org/callback")
	require.ErrorIs(t, err, ErrInvalidInput)
}

func TestPrivateShelvesPersistAndDisconnectRevokes(t *testing.T) {
	var revoked atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth2/token":
			checkBasic(t, r)
			assert.Equal(t, "authorization_code", r.PostForm.Get("grant_type"))
			assert.Equal(t, testCallback, r.PostForm.Get("redirect_uri"))
			assert.Equal(t, testVerifier, r.PostForm.Get("code_verifier"))
			sendTokens(w, r.PostForm.Get("code"), 3600)
		case "/v1/graphql":
			assert.Equal(t, http.MethodPost, r.Method)
			assert.Equal(t, "application/json", r.Header.Get("Content-Type"))
			var req struct {
				Query     string         `json:"query"`
				Variables map[string]int `json:"variables"`
			}
			if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&req)) {
				return
			}
			id, username := 7, "reader-alice"
			switch r.Header.Get("Authorization") {
			case "Bearer hc_at_alice-code":
			case "Bearer hc_at_bob-code":
				id, username = 9, "reader-bob"
			default:
				assert.Fail(t, "unexpected bearer credential")
				w.WriteHeader(401)
				return
			}
			if strings.Contains(req.Query, "me { id username }") {
				sendProfile(w, id, username)
				return
			}
			assert.Contains(t, req.Query, "user_id: {_eq: $user}")
			assert.Contains(t, req.Query, "status_id: {_eq: 1}")
			assert.Contains(t, req.Query, "order_by: {id: asc}")
			assert.Equal(t, id, req.Variables["user"])
			assert.Equal(t, 25, req.Variables["limit"])
			offset := req.Variables["offset"]
			size := 1
			if id == 7 && offset == 0 {
				size = 25
			}
			rows := make([]any, 0, size)
			for i := range size {
				rows = append(rows, map[string]any{"book": map[string]any{
					"id": id*100 + offset + i, "title": fmt.Sprintf("Book for %s", username),
					"contributions": []any{map[string]any{"author": map[string]any{"name": "Author One"}}, map[string]any{"author": map[string]any{"name": "Author Two"}}},
				}})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"user_books": rows}})
		case "/oauth2/revoke":
			checkBasic(t, r)
			assert.Equal(t, "refresh_token", r.PostForm.Get("token_type_hint"))
			assert.Equal(t, "hc_rt_alice-code", r.PostForm.Get("token"))
			revoked.Add(1)
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer upstream.Close()
	ctx := context.Background()
	dir := filepath.Join(t.TempDir(), "links")
	c := testClient(t, dir, upstream.URL)
	require.NoError(t, c.Connect(ctx, "alice:gen-1", "alice-code", testVerifier))
	require.NoError(t, c.Connect(ctx, "bob:gen-1", "bob-code", testVerifier))

	mode, err := os.Stat(dir)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0700), mode.Mode().Perm())
	for _, file := range []string{"key", accountName("alice:gen-1") + ".link"} {
		mode, err := os.Stat(filepath.Join(dir, file))
		require.NoError(t, err)
		require.Equal(t, os.FileMode(0600), mode.Mode().Perm())
		bytes, err := os.ReadFile(filepath.Join(dir, file))
		require.NoError(t, err)
		require.NotContains(t, string(bytes), "alice-code")
		require.NotContains(t, string(bytes), "reader-alice")
	}
	persisted, err := os.ReadFile(filepath.Join(dir, accountName("alice:gen-1")+".link"))
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, accountName("copied")+".link"), persisted, 0600))
	_, err = c.Status("copied")
	require.ErrorIs(t, err, errStorage)

	c = testClient(t, dir, upstream.URL)
	username, err := c.Status("alice:gen-1")
	require.NoError(t, err)
	require.Equal(t, "reader-alice", username)
	_, err = c.Status("alice:gen-2")
	require.ErrorIs(t, err, ErrNotConnected)
	_, err = c.Shelf(ctx, "alice:gen-1", -1)
	require.ErrorIs(t, err, ErrInvalidInput)
	first, err := c.Shelf(ctx, "alice:gen-1", 0)
	require.NoError(t, err)
	require.Len(t, first.Books, 25)
	require.Equal(t, Book{ID: "700", Title: "Book for reader-alice", Author: "Author One, Author Two"}, first.Books[0])
	require.NotNil(t, first.NextOffset)
	require.Equal(t, 25, *first.NextOffset)
	last, err := c.Shelf(ctx, "alice:gen-1", *first.NextOffset)
	require.NoError(t, err)
	require.Nil(t, last.NextOffset)
	require.Len(t, last.Books, 1)
	require.Equal(t, "725", last.Books[0].ID)
	bob, err := c.Shelf(ctx, "bob:gen-1", 0)
	require.NoError(t, err)
	require.Len(t, bob.Books, 1)
	require.Equal(t, "900", bob.Books[0].ID)

	require.NoError(t, c.Disconnect(ctx, "alice:gen-1"))
	require.NoError(t, c.Disconnect(ctx, "alice:gen-1"))
	require.EqualValues(t, 1, revoked.Load())
	_, err = c.Shelf(ctx, "alice:gen-1", 0)
	require.ErrorIs(t, err, ErrNotConnected)
	_, err = c.Status("bob:gen-1")
	require.NoError(t, err)
}

func TestRefreshRotationAcrossClientsAndRestart(t *testing.T) {
	var refreshes atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/token" {
			checkBasic(t, r)
			if r.PostForm.Get("grant_type") == "authorization_code" {
				sendTokens(w, "old", 1)
				return
			}
			assert.Equal(t, "refresh_token", r.PostForm.Get("grant_type"))
			assert.Equal(t, "hc_rt_old", r.PostForm.Get("refresh_token"))
			assert.EqualValues(t, 1, refreshes.Add(1))
			time.Sleep(30 * time.Millisecond)
			sendTokens(w, "new", 3600)
			return
		}
		var req struct {
			Query string `json:"query"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if strings.Contains(req.Query, "AnthoLumeProfile") {
			sendProfile(w, 33, "one-reader")
			return
		}
		assert.Equal(t, "Bearer hc_at_new", r.Header.Get("Authorization"))
		_, _ = w.Write([]byte(`{"data":{"user_books":[]}}`))
	}))
	defer upstream.Close()
	ctx := context.Background()
	dir := filepath.Join(t.TempDir(), "links")
	one, two := testClient(t, dir, upstream.URL), testClient(t, dir, upstream.URL)
	require.NoError(t, one.Connect(ctx, "account", "code", testVerifier))
	var group sync.WaitGroup
	for range 4 {
		for _, client := range []*Client{one, two} {
			group.Go(func() {
				page, err := client.Shelf(ctx, "account", 0)
				assert.NoError(t, err)
				assert.Equal(t, []Book{}, page.Books)
			})
		}
	}
	group.Wait()
	_, err := testClient(t, dir, upstream.URL).Shelf(ctx, "account", 0)
	require.NoError(t, err)
	require.EqualValues(t, 1, refreshes.Load())
}

func TestUncertainRefreshRequiresReconnectAndNeverReplays(t *testing.T) {
	var refreshes atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/token" {
			checkBasic(t, r)
			if r.PostForm.Get("grant_type") == "authorization_code" {
				sendTokens(w, "old", 1)
				return
			}
			refreshes.Add(1)
			w.Header().Set("Content-Length", "700")
			_, _ = w.Write([]byte(`{"incomplete":"provider error must not escape"`))
			return
		}
		sendProfile(w, 42, "reader")
	}))
	defer upstream.Close()
	ctx := context.Background()
	dir := filepath.Join(t.TempDir(), "links")
	c := testClient(t, dir, upstream.URL)
	require.NoError(t, c.Connect(ctx, "account", "code", testVerifier))
	_, err := c.Shelf(ctx, "account", 0)
	require.ErrorIs(t, err, ErrReconnect)
	c = testClient(t, dir, upstream.URL)
	username, err := c.Status("account")
	require.ErrorIs(t, err, ErrReconnect)
	require.Equal(t, "reader", username)
	_, err = c.Shelf(ctx, "account", 0)
	require.ErrorIs(t, err, ErrReconnect)
	require.EqualValues(t, 1, refreshes.Load())
	require.NoError(t, c.Connect(ctx, "account", "new-code", testVerifier))
	_, err = c.Status("account")
	require.NoError(t, err)
}

func TestProviderRedirectAndRevocationFailureDoNotLeakCredentials(t *testing.T) {
	var redirected atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirected.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer destination.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oauth2/token":
			checkBasic(t, r)
			sendTokens(w, "pair", 3600)
		case "/v1/graphql":
			sendProfile(w, 4, "reader")
		case "/oauth2/revoke":
			http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
		}
	}))
	defer upstream.Close()
	ctx := context.Background()
	client := testClient(t, filepath.Join(t.TempDir(), "links"), upstream.URL)
	require.NoError(t, client.Connect(ctx, "account", "code", testVerifier))
	err := client.Disconnect(ctx, "account")
	require.ErrorIs(t, err, ErrRevocationUnconfirmed)
	require.NotContains(t, err.Error(), "hc_rt_pair")
	require.Zero(t, redirected.Load())
	_, err = client.Status("account")
	require.ErrorIs(t, err, ErrNotConnected)
}

func TestDisconnectDoesNotReportSuccessIfLocalRemovalFails(t *testing.T) {
	client := testClient(t, filepath.Join(t.TempDir(), "links"), "")
	link := filepath.Join(client.store.dir, accountName("account")+".link")
	require.NoError(t, os.Mkdir(link, 0700))
	obstruction := filepath.Join(link, "file")
	require.NoError(t, os.WriteFile(obstruction, []byte("can't unlink a non-empty directory"), 0600))
	err := client.Disconnect(context.Background(), "account")
	require.ErrorIs(t, err, errStorage)
	require.NotErrorIs(t, err, ErrRevocationUnconfirmed)
	require.FileExists(t, obstruction)
}

func TestDisconnectRemovesUnreadableCredentialWithUnconfirmedRevocation(t *testing.T) {
	client := testClient(t, filepath.Join(t.TempDir(), "links"), "")
	link := filepath.Join(client.store.dir, accountName("account")+".link")
	require.NoError(t, os.WriteFile(link, []byte("invalid ciphertext"), 0600))
	require.ErrorIs(t, client.Disconnect(context.Background(), "account"), ErrRevocationUnconfirmed)
	require.NoFileExists(t, link)
	require.NoError(t, client.Disconnect(context.Background(), "account"))
}
