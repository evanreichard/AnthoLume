package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDefaultPublicOriginPorts(t *testing.T) {
	for input, expected := range map[string]string{
		"https://books.example:443": "https://books.example",
		"http://localhost:80":       "http://localhost",
		"http://127.0.0.1:80":       "http://127.0.0.1",
		"http://[::1]:80":           "http://[::1]",
	} {
		cfg := &Config{PublicOrigin: input}
		require.NoError(t, cfg.NormalizePublicOrigin())
		require.Equal(t, expected, cfg.PublicOrigin)
		require.NoError(t, cfg.NormalizePublicOrigin())
		require.Equal(t, expected, cfg.PublicOrigin)
	}
}

func TestExactPublicOrigin(t *testing.T) {
	for _, origin := range []string{"https://books.example", "https://books.example:8443", "http://127.0.0.1:5173", "http://127.0.0.2", "http://localhost:8585", "http://[::1]:8585"} {
		cfg := &Config{PublicOrigin: origin}
		require.NoError(t, cfg.NormalizePublicOrigin(), origin)
		require.Equal(t, origin, cfg.PublicOrigin)
	}
	for _, origin := range []string{"", "http://books.example", "https://*.example", "https://user:secret@books.example", "https://books.example/", "https://books.example/path", "https://books.example?x=y", "https://books.example#fragment", "null", "https://books.example,https://other.example", "ftp://books.example", "http://localhost.evil"} {
		require.Error(t, (&Config{PublicOrigin: origin}).NormalizePublicOrigin(), origin)
	}
}
