package config

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestHardcoverCatalogTokenIsIndependentOfOAuth(t *testing.T) {
	t.Setenv("CONFIG_PATH", t.TempDir())
	t.Setenv("DATA_PATH", t.TempDir())
	t.Setenv("HARDCOVER_CLIENT_ID", "")
	t.Setenv("HARDCOVER_CLIENT_SECRET", "")
	t.Setenv("HARDCOVER_TOKEN_KEY", "")
	const token = "synthetic-case-SENSITIVE-catalog-token"
	for _, input := range []string{"", "  ", " " + token + "\n"} {
		t.Setenv("HARDCOVER_CATALOG_TOKEN", input)
		cfg, err := Load()
		require.NoError(t, err)
		if input == " "+token+"\n" {
			require.Equal(t, token, cfg.HardcoverCatalogToken())
		} else {
			require.Empty(t, cfg.HardcoverCatalogToken())
		}
		out, err := json.Marshal(cfg)
		require.NoError(t, err)
		require.NotContains(t, string(out), token)
	}
}
