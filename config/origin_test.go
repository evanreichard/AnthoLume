package config

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestExactPublicOrigin(t *testing.T) {
	for _, origin := range []string{"https://books.example", "https://books.example:8443", "http://127.0.0.1:5173", "http://127.0.0.2", "http://localhost:8585", "http://[::1]:8585"} {
		require.NoError(t, (&Config{PublicOrigin: origin}).ValidatePublicOrigin(), origin)
	}
	for _, origin := range []string{"", "http://books.example", "https://*.example", "https://user:secret@books.example", "https://books.example/", "https://books.example/path", "https://books.example?x=y", "https://books.example#fragment", "null", "https://books.example,https://other.example", "ftp://books.example", "http://localhost.evil"} {
		require.Error(t, (&Config{PublicOrigin: origin}).ValidatePublicOrigin(), origin)
	}
}
