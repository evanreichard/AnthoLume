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

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	fixtureID     = "fixture-client"
	fixtureSecret = "fixture-secret"
	callback      = "https://books.example.org/oauth/hardcover/callback"
	verifier      = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
)

type providerFixture struct {
	expires        int
	badRefresh     bool
	omitRotation   bool
	shelfStatus    func(token string) int
	revokeRedirect string
	refreshes      atomic.Int32
	lastRevoked    atomic.Value
}

func (f *providerFixture) start(t *testing.T) (dir string, open func() *Client) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		if r.URL.Path == "/v1/graphql" {
			var query struct {
				Query     string
				Variables map[string]int
			}
			if !assert.NoError(t, json.NewDecoder(r.Body).Decode(&query)) {
				return
			}
			token := r.Header.Get("Authorization")
			if !assert.Contains(t, []string{"Bearer hc_at_alice", "Bearer hc_at_bob", "Bearer hc_at_switched", "Bearer hc_at_renewed", "Bearer hc_at_again"}, token) {
				return
			}
			id, username := 7, "alice"
			if token == "Bearer hc_at_bob" || token == "Bearer hc_at_switched" {
				id, username = 9, "bob"
			}
			if strings.Contains(query.Query, "me { id username }") {
				fmt.Fprintf(w, `{"data":{"me":[{"id":%d,"username":%q}]}}`, id, username)
				return
			}
			if f.shelfStatus != nil {
				if status := f.shelfStatus(token); status != http.StatusOK {
					w.WriteHeader(status)
					return
				}
			}
			assert.Contains(t, query.Query, "user_id: {_eq: $user}")
			assert.Contains(t, query.Query, "status_id: {_eq: 1}")
			assert.Contains(t, query.Query, "order_by: {id: asc}")
			offset := query.Variables["offset"]
			assert.Equal(t, map[string]int{"user": id, "offset": offset, "limit": 25}, query.Variables)
			rows := []json.RawMessage{}
			for i := offset; i < 26 && i < offset+25; i++ {
				rows = append(rows, json.RawMessage(fmt.Sprintf(`{"book":{"id":%d,"title":"A book","contributions":[{"author":{"name":"One"}},{"author":{"name":"Two"}}]}}`, id*100+i)))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"user_books": rows}})
			return
		}
		id, secret, ok := r.BasicAuth()
		assert.True(t, ok && id == fixtureID && secret == fixtureSecret)
		assert.NoError(t, r.ParseForm())
		switch r.URL.Path {
		case "/oauth2/token":
			w.Header().Set("Content-Type", "application/json")
			pair, expires := r.PostForm.Get("code"), 3600
			if r.PostForm.Get("grant_type") == "refresh_token" {
				assert.Equal(t, "hc_rt_alice", r.PostForm.Get("refresh_token"))
				f.refreshes.Add(1)
				if f.badRefresh {
					w.Header().Set("Content-Length", "700")
					fmt.Fprint(w, `{"access_token":`)
					return
				}
				if f.omitRotation {
					fmt.Fprint(w, `{"access_token":"hc_at_renewed","expires_in":3600}`)
					return
				}
				pair = "renewed"
			} else {
				assert.Equal(t, "authorization_code", r.PostForm.Get("grant_type"))
				assert.Equal(t, callback, r.PostForm.Get("redirect_uri"))
				assert.Equal(t, verifier, r.PostForm.Get("code_verifier"))
				if f.expires != 0 && pair == "alice" {
					expires = f.expires
				}
			}
			fmt.Fprintf(w, `{"access_token":"hc_at_%s","refresh_token":"hc_rt_%s","expires_in":%d,"token_type":"Bearer"}`, pair, pair, expires)
		case "/oauth2/revoke":
			assert.Equal(t, "refresh_token", r.PostForm.Get("token_type_hint"))
			f.lastRevoked.Store(r.PostForm.Get("token"))
			if f.revokeRedirect != "" {
				http.Redirect(w, r, f.revokeRedirect, http.StatusTemporaryRedirect)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	dir = filepath.Join(t.TempDir(), "links")
	return dir, func() *Client {
		c, err := New(dir, fixtureID, fixtureSecret, callback)
		require.NoError(t, err)
		c.oauth.Endpoint.TokenURL, c.graphql, c.revoke = server.URL+"/oauth2/token", server.URL+"/v1/graphql", server.URL+"/oauth2/revoke"
		return c
	}
}

func TestOAuthConsentAndPrivateShelf(t *testing.T) {
	f := &providerFixture{}
	dir, open := f.start(t)
	c, ctx := open(), context.Background()
	u, err := url.Parse(c.AuthorizeURL("state +/= value", verifier))
	require.NoError(t, err)
	require.Equal(t, "https://hardcover.app/oauth2/authorize", u.Scheme+"://"+u.Host+u.Path)
	require.Equal(t, url.Values{
		"client_id": {fixtureID}, "redirect_uri": {callback}, "response_type": {"code"},
		"code_challenge_method": {"S256"}, "code_challenge": {"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"},
		"state": {"state +/= value"}, "scope": {"read:me:content read:library"},
	}, u.Query())
	require.Empty(t, c.AuthorizeURL("state", strings.Repeat("+", 43)))
	_, err = New(dir, fixtureID, fixtureSecret, "http://books.example.org/callback")
	require.ErrorIs(t, err, ErrInvalidInput)
	require.NoError(t, c.Connect(ctx, "account-a", "alice", verifier))
	require.NoError(t, c.Connect(ctx, "account-b", "bob", verifier))

	link := filepath.Join(dir, accountName("account-a")+".link")
	contents, err := os.ReadFile(link)
	require.NoError(t, err)
	require.NotContains(t, string(contents), "hc_rt_alice")
	require.NotContains(t, string(contents), "hc_at_alice")
	for path, mode := range map[string]os.FileMode{dir: 0700, filepath.Join(dir, "key"): 0600, link: 0600} {
		info, err := os.Stat(path)
		require.NoError(t, err)
		require.Equal(t, mode, info.Mode().Perm())
	}
	require.NoError(t, os.WriteFile(filepath.Join(dir, accountName("copied")+".link"), contents, 0600))
	c = open()
	_, err = c.Status("copied")
	require.Error(t, err)
	_, err = c.Status("other-generation")
	require.ErrorIs(t, err, ErrNotConnected)
	first, err := c.Shelf(ctx, "account-a", 0)
	require.NoError(t, err)
	require.Len(t, first.Books, 25)
	require.Equal(t, Book{ID: "700", Title: "A book", Author: "One, Two"}, first.Books[0])
	require.Equal(t, 25, *first.NextOffset)
	last, err := c.Shelf(ctx, "account-a", *first.NextOffset)
	require.NoError(t, err)
	require.Nil(t, last.NextOffset)
	require.Len(t, last.Books, 1)
	require.Equal(t, "725", last.Books[0].ID)
	bob, err := c.Shelf(ctx, "account-b", 0)
	require.NoError(t, err)
	require.Equal(t, "900", bob.Books[0].ID)

	require.ErrorIs(t, c.Connect(ctx, "account-a", "switched", verifier), ErrIdentity)
	require.Equal(t, "hc_rt_switched", f.lastRevoked.Load())
	name, err := c.Status("account-a")
	require.NoError(t, err)
	require.Equal(t, "alice", name)
	require.NoError(t, c.Disconnect(ctx, "account-a"))
	require.Equal(t, "hc_rt_alice", f.lastRevoked.Load())
	_, err = open().Status("account-a")
	require.ErrorIs(t, err, ErrNotConnected)
	_, err = c.Status("account-b")
	require.NoError(t, err)
}

func TestConcurrentRefreshPersistsReplacement(t *testing.T) {
	f := &providerFixture{expires: 1, shelfStatus: func(token string) int {
		if token == "Bearer hc_at_renewed" {
			return http.StatusOK
		}
		return http.StatusUnauthorized
	}}
	_, open := f.start(t)
	c, ctx := open(), context.Background()
	require.NoError(t, c.Connect(ctx, "account", "alice", verifier))
	var group sync.WaitGroup
	for _, reader := range []*Client{c, open()} {
		group.Go(func() { _, err := reader.Shelf(ctx, "account", 0); assert.NoError(t, err) })
	}
	group.Wait()
	_, err := open().Shelf(ctx, "account", 0)
	require.NoError(t, err)
	require.EqualValues(t, 1, f.refreshes.Load())
}

func TestRefreshFailureRequiresReconnectWithoutReplay(t *testing.T) {
	for _, failure := range []string{"response lost", "replacement rejected", "no rotated refresh token"} {
		t.Run(failure, func(t *testing.T) {
			var reads atomic.Int32
			f := &providerFixture{badRefresh: failure == "response lost", omitRotation: failure == "no rotated refresh token", shelfStatus: func(token string) int {
				if reads.Add(1) == 1 {
					return http.StatusServiceUnavailable
				}
				if token == "Bearer hc_at_again" {
					return http.StatusOK
				}
				return http.StatusUnauthorized
			}}
			_, open := f.start(t)
			c, ctx := open(), context.Background()
			require.NoError(t, c.Connect(ctx, "account", "alice", verifier))
			_, err := c.Shelf(ctx, "account", 0)
			require.ErrorIs(t, err, ErrProvider)
			require.Zero(t, f.refreshes.Load())
			_, err = c.Shelf(ctx, "account", 0)
			require.ErrorIs(t, err, ErrReconnect)
			c = open()
			name, err := c.Status("account")
			require.ErrorIs(t, err, ErrReconnect)
			require.Equal(t, "alice", name)
			_, err = c.Shelf(ctx, "account", 0)
			require.ErrorIs(t, err, ErrReconnect)
			require.EqualValues(t, 1, f.refreshes.Load())
			require.NoError(t, c.Connect(ctx, "account", "again", verifier))
			_, err = c.Shelf(ctx, "account", 0)
			require.NoError(t, err)
		})
	}
}

func TestDisconnectDoesNotFollowRedirectOrKeepLink(t *testing.T) {
	var redirected atomic.Bool
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Store(true) }))
	defer destination.Close()
	f := &providerFixture{revokeRedirect: destination.URL}
	_, open := f.start(t)
	c, ctx := open(), context.Background()
	require.NoError(t, c.Connect(ctx, "account", "alice", verifier))
	err := c.Disconnect(ctx, "account")
	require.ErrorIs(t, err, ErrRevocationUnconfirmed)
	require.NotContains(t, err.Error(), "hc_rt_alice")
	require.False(t, redirected.Load())
	_, err = open().Status("account")
	require.ErrorIs(t, err, ErrNotConnected)
}

func TestDisconnectDistinguishesUnreadableLinkFromFailedRemoval(t *testing.T) {
	dir, open := (&providerFixture{}).start(t)
	c := open()
	link := filepath.Join(dir, accountName("account")+".link")
	require.NoError(t, os.Mkdir(link, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(link, "obstruction"), nil, 0600))
	ctx := context.Background()
	require.ErrorIs(t, c.Disconnect(ctx, "account"), errStorage)
	corrupt := filepath.Join(dir, accountName("corrupt")+".link")
	require.NoError(t, os.WriteFile(corrupt, []byte("invalid ciphertext"), 0600))
	require.ErrorIs(t, c.Disconnect(ctx, "corrupt"), ErrRevocationUnconfirmed)
	require.NoFileExists(t, corrupt)
	require.NoError(t, c.Disconnect(ctx, "corrupt"))
}
