package hardcover

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
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
	pageSize     = 25
	maxOffset    = 1<<31 - pageSize - 1 // GraphQL Int is signed 32-bit.
	requestLimit = 10 * time.Second
)

type Client struct {
	store           credentialStore
	oauth           oauth2.Config
	revoke, graphql string
	http            *http.Client
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
		store: store,
		oauth: oauth2.Config{
			ClientID: clientID, ClientSecret: clientSecret, RedirectURL: redirectURI,
			Scopes:   []string{"read:me:content", "read:library"},
			Endpoint: oauth2.Endpoint{AuthURL: "https://hardcover.app/oauth2/authorize", TokenURL: "https://api.hardcover.app/oauth2/token", AuthStyle: oauth2.AuthStyleInHeader},
		},
		revoke:  "https://api.hardcover.app/oauth2/revoke",
		graphql: "https://api.hardcover.app/v1/graphql",
		http: &http.Client{Timeout: requestLimit, CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		}},
	}, nil
}

// AuthorizeURL returns an empty string for invalid state or a malformed PKCE verifier.
// Callers own creation, expiration, and validation of state and the verifier.
func (c *Client) AuthorizeURL(state, verifier string) string {
	if state == "" || !pkceVerifier.MatchString(verifier) {
		return ""
	}
	return c.oauth.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier))
}

var pkceVerifier = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)

func (c *Client) Connect(ctx context.Context, account, code, verifier string) error {
	if code == "" || !pkceVerifier.MatchString(verifier) {
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
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.http)
	link, err := hardcoverCredential(c.oauth.Exchange(ctx, code, oauth2.VerifierOption(verifier)))
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
		return err
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
	if time.Until(link.ExpiresAt) > 30*time.Second {
		page, err := c.readPage(ctx, link, offset)
		if !errors.Is(err, ErrReconnect) {
			return page, err
		}
	}
	link, err = c.refresh(ctx, account, link)
	if err != nil {
		return Shelf{}, err
	}
	page, err := c.readPage(ctx, link, offset)
	if errors.Is(err, ErrReconnect) {
		// Rejected After Refresh - Don't repeat rotation when the provider rejects a replacement access token.
		if err := c.markReconnect(account, link); err != nil {
			return Shelf{}, err
		}
		return Shelf{}, ErrReconnect
	}
	return page, err
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
	ctx = context.WithValue(ctx, oauth2.HTTPClient, c.http)
	// Single Rotation - Supply only the refresh token so TokenSource makes one exchange, even after an early access-token rejection.
	source := c.oauth.TokenSource(ctx, &oauth2.Token{RefreshToken: refreshToken})
	next, err := hardcoverCredential(source.Token())
	// Hardcover rotates on every use; oauth2 otherwise retains the spent token when the response omits its replacement.
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
