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
)

const responseLimit = 1 << 20

var errUnauthorized = errors.New("hardcover: provider rejected authorization")

func publicProviderError(err error) error {
	if errors.Is(err, errUnauthorized) {
		return ErrReconnect
	}
	return err
}

func (c *Client) exchange(ctx context.Context, values url.Values) (credential, error) {
	var tokens struct {
		Access  string `json:"access_token"`
		Refresh string `json:"refresh_token"`
		Expires int64  `json:"expires_in"`
		Type    string `json:"token_type"`
	}
	if err := c.form(ctx, c.token, values, &tokens); err != nil {
		return credential{}, publicProviderError(err)
	}
	if !validToken(tokens.Access) || !validToken(tokens.Refresh) || tokens.Expires < 1 || tokens.Expires > 366*24*60*60 ||
		(tokens.Type != "" && !strings.EqualFold(tokens.Type, "Bearer")) {
		return credential{}, ErrProvider
	}
	return credential{Access: tokens.Access, Refresh: tokens.Refresh, ExpiresAt: c.now().Add(time.Duration(tokens.Expires) * time.Second)}, nil
}

func validToken(s string) bool {
	if len(s) == 0 || len(s) > 8192 {
		return false
	}
	for i := range len(s) {
		if s[i] <= 0x20 || s[i] > 0x7e {
			return false
		}
	}
	return true
}

func (c *Client) revokeToken(ctx context.Context, link credential) error {
	token, hint := link.Refresh, "refresh_token"
	if token == "" {
		token, hint = link.Access, "access_token"
	}
	err := c.form(ctx, c.revoke, url.Values{"token": {token}, "token_type_hint": {hint}}, nil)
	if errors.Is(err, errUnauthorized) {
		return ErrProvider
	}
	return err
}

func (c *Client) form(ctx context.Context, endpoint string, data url.Values, result any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return ErrProvider
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(c.id, c.secret)
	return c.send(req, result)
}

func (c *Client) query(ctx context.Context, token, query string, vars map[string]int64, result any) error {
	body, err := json.Marshal(struct {
		Query     string           `json:"query"`
		Variables map[string]int64 `json:"variables,omitempty"`
	}{query, vars})
	if err != nil {
		return ErrProvider
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.graphql, strings.NewReader(string(body)))
	if err != nil {
		return ErrProvider
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	var response struct {
		Data   json.RawMessage   `json:"data"`
		Errors []json.RawMessage `json:"errors"`
	}
	if err := c.send(req, &response); err != nil {
		return err
	}
	if len(response.Errors) != 0 || len(response.Data) == 0 || string(response.Data) == "null" || json.Unmarshal(response.Data, result) != nil {
		return ErrProvider
	}
	return nil
}

func (c *Client) send(req *http.Request, result any) error {
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		if req.Context().Err() != nil {
			return req.Context().Err()
		}
		return ErrProvider
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized {
		return errUnauthorized
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ErrProvider
	}
	if result != nil {
		body, err := io.ReadAll(io.LimitReader(resp.Body, responseLimit+1))
		if err != nil || len(body) > responseLimit || json.Unmarshal(body, result) != nil {
			if req.Context().Err() != nil {
				return req.Context().Err()
			}
			return ErrProvider
		}
	}
	return nil
}
