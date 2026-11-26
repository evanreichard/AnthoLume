package shelfmark

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
)

const MaxSelectionLength = 256 << 10

var ErrInvalidSelection = errors.New("invalid Shelfmark release selection; search again")

var selectionEncoding = base64.RawURLEncoding.Strict()

type releaseSelection struct {
	Book    Book
	Release Release
	Payload json.RawMessage
}

func newSelectionCipher(key string) (cipher.AEAD, error) {
	derived, err := hkdf.Key(sha256.New, []byte(key), nil, "AnthoLume Shelfmark release selection v1", 32)
	if err != nil {
		return nil, err
	}
	defer clear(derived)
	block, err := aes.NewCipher(derived)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCMWithRandomNonce(block)
}

func (c *Client) selectionBinding(provider, id, key string) []byte {
	return []byte(c.base.String() + "\x00" + provider + "\x00" + id + "\x00" + key)
}

func (c *Client) sealSelection(book Book, item verifiedRelease) (string, error) {
	// History Snapshot - History shows the byline and cover, not the synopsis; avoid repeating it in every token.
	book.Description = ""
	plain, err := json.Marshal(releaseSelection{Book: book, Release: item.release, Payload: item.payload})
	if err != nil {
		return "", err
	}
	if selectionEncoding.EncodedLen(len(plain)+c.selectionCipher.Overhead()) > MaxSelectionLength {
		return "", ErrInvalidSelection
	}
	sealed := c.selectionCipher.Seal(nil, nil, plain, c.selectionBinding(book.Provider, book.ID, item.release.Key))
	return selectionEncoding.EncodeToString(sealed), nil
}

func (c *Client) OpenSelection(provider, id, key, selection string) (Book, Release, error) {
	if !validBookKey(provider, id) || len(key) != sha256.Size*2 || len(selection) > MaxSelectionLength {
		return Book{}, Release{}, ErrInvalidSelection
	}
	sealed, err := selectionEncoding.DecodeString(selection)
	if err != nil {
		return Book{}, Release{}, ErrInvalidSelection
	}
	plain, err := c.selectionCipher.Open(nil, nil, sealed, c.selectionBinding(provider, id, key))
	if err != nil {
		return Book{}, Release{}, ErrInvalidSelection
	}
	var selected releaseSelection
	if json.Unmarshal(plain, &selected) != nil {
		return Book{}, Release{}, ErrInvalidSelection
	}
	var identity struct {
		SourceID string `json:"source_id"`
	}
	if json.Unmarshal(selected.Payload, &identity) != nil || identity.SourceID == "" {
		return Book{}, Release{}, ErrInvalidSelection
	}
	selected.Release.SourceID = identity.SourceID
	selected.Release.payload = selected.Payload
	return selected.Book, selected.Release, nil
}
