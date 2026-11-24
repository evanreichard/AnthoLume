package hardcover

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var (
	ErrInvalidInput          = errors.New("hardcover: invalid input")
	ErrNotConnected          = errors.New("hardcover: account is not connected")
	ErrReconnect             = errors.New("hardcover: account must reconnect")
	ErrProvider              = errors.New("hardcover: provider request failed")
	ErrIdentity              = errors.New("hardcover: disconnect the existing Hardcover identity before switching accounts")
	ErrRevocationUnconfirmed = errors.New("hardcover: account disconnected locally but remote revocation could not be confirmed")
)

const (
	scope        = "read:me:content read:library"
	pageSize     = 25
	maxOffset    = 1<<31 - pageSize - 1 // GraphQL Int is signed 32-bit.
	requestLimit = 10 * time.Second
)

type Client struct {
	store                    credentialStore
	id, secret, redirectURI  string
	authorize, token, revoke string
	graphql                  string
	http                     *http.Client
	now                      func() time.Time
}

type Shelf struct {
	Books      []Book `json:"books"`
	NextOffset *int   `json:"next_offset"`
}

type Book struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Author string `json:"author"`
}

// New opens a dedicated private directory outside portable application backups.
func New(dir, clientID, clientSecret, redirectURI string) (*Client, error) {
	u, err := url.Parse(redirectURI)
	if clientID == "" || clientSecret == "" || err != nil || u.Hostname() == "" || u.User != nil || u.Opaque != "" || strings.Contains(redirectURI, "#") {
		return nil, ErrInvalidInput
	}
	ip := net.ParseIP(u.Hostname())
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || ip != nil && ip.IsLoopback())) {
		return nil, ErrInvalidInput
	}
	store, err := newCredentialStore(dir)
	if err != nil {
		return nil, err
	}
	return &Client{
		store: store, id: clientID, secret: clientSecret, redirectURI: redirectURI,
		authorize: "https://hardcover.app/oauth2/authorize",
		token:     "https://api.hardcover.app/oauth2/token",
		revoke:    "https://api.hardcover.app/oauth2/revoke",
		graphql:   "https://api.hardcover.app/v1/graphql",
		http: &http.Client{Timeout: requestLimit, CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}},
		now: time.Now,
	}, nil
}

// AuthorizeURL returns an empty string for invalid state or a malformed PKCE verifier.
// Callers own creation, expiration, and validation of state and the verifier.
func (c *Client) AuthorizeURL(state, verifier string) string {
	if state == "" || !validVerifier(verifier) {
		return ""
	}
	hash := sha256.Sum256([]byte(verifier))
	return c.authorize + "?" + (url.Values{
		"response_type": {"code"}, "client_id": {c.id}, "redirect_uri": {c.redirectURI},
		"state": {state}, "scope": {scope}, "code_challenge_method": {"S256"},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(hash[:])},
	}).Encode()
}

func validVerifier(verifier string) bool {
	if len(verifier) < 43 || len(verifier) > 128 {
		return false
	}
	for _, r := range verifier {
		if !('a' <= r && r <= 'z' || 'A' <= r && r <= 'Z' || '0' <= r && r <= '9' || strings.ContainsRune("-._~", r)) {
			return false
		}
	}
	return true
}

func (c *Client) Connect(ctx context.Context, account, code, verifier string) error {
	if code == "" || !validVerifier(verifier) {
		return ErrInvalidInput
	}
	unlock, err := c.lock(ctx, account)
	if err != nil {
		return err
	}
	defer unlock()
	previous, err := c.store.load(account)
	if err != nil && !errors.Is(err, ErrNotConnected) {
		return err
	}
	link, err := c.exchange(ctx, url.Values{
		"grant_type": {"authorization_code"}, "code": {code}, "code_verifier": {verifier}, "redirect_uri": {c.redirectURI},
	})
	if err != nil {
		return err
	}
	var profile struct {
		Me []struct {
			ID       int64  `json:"id"`
			Username string `json:"username"`
		} `json:"me"`
	}
	if err := c.query(ctx, link.Access, `query AnthoLumeProfile { me { id username } }`, nil, &profile); err != nil {
		_ = c.revokeToken(ctx, link)
		return publicProviderError(err)
	}
	if len(profile.Me) != 1 || profile.Me[0].ID < 1 || strings.TrimSpace(profile.Me[0].Username) == "" {
		_ = c.revokeToken(ctx, link)
		return ErrProvider
	}
	link.UserID, link.Username = profile.Me[0].ID, profile.Me[0].Username
	if previous.UserID != 0 && previous.UserID != link.UserID {
		_ = c.revokeToken(ctx, link)
		return ErrIdentity
	}
	return c.store.save(account, link)
}

func (c *Client) Status(account string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), requestLimit)
	defer cancel()
	unlock, err := c.lock(ctx, account)
	if err != nil {
		return "", err
	}
	defer unlock()
	link, err := c.store.load(account)
	if err != nil {
		return "", err
	}
	if link.Refresh == "" {
		return link.Username, ErrReconnect
	}
	return link.Username, nil
}

func (c *Client) Disconnect(ctx context.Context, account string) error {
	unlock, err := c.lock(ctx, account)
	if err != nil {
		return err
	}
	defer unlock()
	link, err := c.store.load(account)
	if removeErr := c.store.remove(account); removeErr != nil {
		return removeErr
	}
	if errors.Is(err, ErrNotConnected) {
		return nil
	}
	if err != nil || c.revokeToken(ctx, link) != nil {
		return ErrRevocationUnconfirmed
	}
	return nil
}

const shelfQuery = `query AnthoLumeWantToRead($user: Int!, $offset: Int!, $limit: Int!) {
  user_books(where: {user_id: {_eq: $user}, status_id: {_eq: 1}}, order_by: {id: asc}, offset: $offset, limit: $limit) {
    book { id title contributions(where: {contribution: {_eq: "Author"}}) { author { name } } }
  }
}`

func (c *Client) Shelf(ctx context.Context, account string, offset int) (Shelf, error) {
	if offset < 0 || offset > maxOffset {
		return Shelf{}, ErrInvalidInput
	}
	unlock, err := c.lock(ctx, account)
	if err != nil {
		return Shelf{}, err
	}
	defer unlock()
	link, err := c.store.load(account)
	if err != nil {
		return Shelf{}, err
	}
	if link.Refresh == "" {
		return Shelf{}, ErrReconnect
	}
	refreshed := !c.now().Add(30 * time.Second).Before(link.ExpiresAt)
	if refreshed {
		link, err = c.refresh(ctx, account, link)
		if err != nil {
			return Shelf{}, err
		}
	}
	result, err := c.readPage(ctx, link, offset)
	if errors.Is(err, errUnauthorized) && !refreshed {
		link, err = c.refresh(ctx, account, link)
		if err != nil {
			return Shelf{}, err
		}
		result, err = c.readPage(ctx, link, offset)
	}
	if errors.Is(err, errUnauthorized) {
		// Rejected After Refresh - Don't repeat rotation when the provider rejects a replacement access token.
		if err := c.markReconnect(account, link); err != nil {
			return Shelf{}, err
		}
		return Shelf{}, ErrReconnect
	}
	return result, err
}

func (c *Client) readPage(ctx context.Context, link credential, offset int) (Shelf, error) {
	var data struct {
		Rows []struct {
			Book *struct {
				ID            int64  `json:"id"`
				Title         string `json:"title"`
				Contributions []struct {
					Author struct {
						Name string `json:"name"`
					} `json:"author"`
				} `json:"contributions"`
			} `json:"book"`
		} `json:"user_books"`
	}
	if err := c.query(ctx, link.Access, shelfQuery, map[string]int64{"user": link.UserID, "limit": pageSize, "offset": int64(offset)}, &data); err != nil {
		return Shelf{}, err
	}
	if data.Rows == nil || len(data.Rows) > pageSize {
		return Shelf{}, ErrProvider
	}
	result := Shelf{Books: make([]Book, 0, len(data.Rows))}
	for _, row := range data.Rows {
		if row.Book == nil || row.Book.ID < 1 || strings.TrimSpace(row.Book.Title) == "" {
			continue
		}
		var names []string
		for _, credit := range row.Book.Contributions {
			if name := strings.TrimSpace(credit.Author.Name); name != "" {
				names = append(names, name)
			}
		}
		result.Books = append(result.Books, Book{ID: strconv.FormatInt(row.Book.ID, 10), Title: row.Book.Title, Author: strings.Join(names, ", ")})
	}
	if len(data.Rows) == pageSize && offset <= maxOffset-pageSize {
		next := offset + pageSize
		result.NextOffset = &next
	}
	return result, nil
}

func (c *Client) refresh(ctx context.Context, account string, old credential) (credential, error) {
	if err := ctx.Err(); err != nil {
		return credential{}, err
	}
	refreshToken := old.Refresh
	// Spend Before Send - A crash or a lost response must not replay a rotating token.
	if err := c.markReconnect(account, old); err != nil {
		return credential{}, err
	}
	next, err := c.exchange(ctx, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refreshToken}})
	if err != nil || next.Refresh == refreshToken {
		return credential{}, ErrReconnect
	}
	next.UserID, next.Username = old.UserID, old.Username
	if err := c.store.save(account, next); err != nil {
		return credential{}, err
	}
	return next, nil
}

func (c *Client) markReconnect(account string, link credential) error {
	link.Refresh = ""
	return c.store.save(account, link)
}

func (c *Client) lock(ctx context.Context, account string) (func(), error) {
	if account == "" {
		return nil, ErrInvalidInput
	}
	return c.store.lock(ctx, accountName(account)+".lock")
}
