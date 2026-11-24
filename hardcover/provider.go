package hardcover

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/oauth2"
)

const responseLimit = 1 << 20

func hardcoverCredential(token *oauth2.Token, err error) (credential, error) {
	if err != nil {
		// Redact Provider Errors - RetrieveError may include the raw token endpoint response.
		var denied *oauth2.RetrieveError
		if errors.As(err, &denied) && denied.Response.StatusCode == http.StatusUnauthorized {
			return credential{}, ErrReconnect
		}
		return credential{}, ErrProvider
	}
	ttl := time.Until(token.Expiry)
	if !validToken(token.AccessToken) || !validToken(token.RefreshToken) || ttl <= 0 || ttl > 366*24*time.Hour || token.Type() != "Bearer" {
		return credential{}, ErrProvider
	}
	return credential{Access: token.AccessToken, Refresh: token.RefreshToken, ExpiresAt: token.Expiry}, nil
}

func validToken(s string) bool {
	return len(s) > 0 && len(s) <= 8192 && !strings.ContainsFunc(s, func(r rune) bool { return r <= ' ' || r > '~' })
}

func (c *Client) revokeToken(ctx context.Context, link credential) error {
	token, hint := link.Refresh, "refresh_token"
	if token == "" {
		token, hint = link.Access, "access_token"
	}
	data := url.Values{"token": {token}, "token_type_hint": {hint}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.revoke, strings.NewReader(data.Encode()))
	if err != nil {
		return ErrProvider
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(c.oauth.ClientID, c.oauth.ClientSecret)
	return send(c.http, req, nil)
}

func (c *Client) query(ctx context.Context, token, query string, vars any, result any) error {
	return graphqlQuery(ctx, c.http, c.graphql, token, query, vars, result)
}

const hardcoverUserAgent = "AnthoLume (https://github.com/evanreichard/AnthoLume)"

func graphqlQuery(ctx context.Context, client *http.Client, endpoint, token, query string, vars any, result any) error {
	body, err := json.Marshal(struct {
		Query     string `json:"query"`
		Variables any    `json:"variables,omitempty"`
	}{query, vars})
	if err != nil {
		return ErrProvider
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(body)))
	if err != nil {
		return ErrProvider
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", hardcoverUserAgent)
	var response struct {
		Data   json.RawMessage   `json:"data"`
		Errors []json.RawMessage `json:"errors"`
	}
	if err := send(client, req, &response); err != nil {
		return err
	}
	if len(response.Errors) != 0 || len(response.Data) == 0 || string(response.Data) == "null" || json.Unmarshal(response.Data, result) != nil {
		return ErrProvider
	}
	return nil
}

func send(client *http.Client, req *http.Request, result any) error {
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err == nil {
		defer resp.Body.Close()
		switch {
		case resp.StatusCode == http.StatusUnauthorized:
			return ErrReconnect
		case resp.StatusCode >= 200 && resp.StatusCode < 300:
			if result == nil {
				return nil
			}
			body, err := io.ReadAll(io.LimitReader(resp.Body, responseLimit+1))
			if err == nil && len(body) <= responseLimit && json.Unmarshal(body, result) == nil {
				return nil
			}
		}
	}
	if err := req.Context().Err(); err != nil {
		return err
	}
	return ErrProvider
}
