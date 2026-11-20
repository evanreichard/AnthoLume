package config

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestLoadRejectsRelativeConfigPath(t *testing.T) {
	t.Setenv("CONFIG_PATH", "./data")
	_, err := Load()
	require.ErrorContains(t, err, "CONFIG_PATH must be an absolute path")
}

func TestAbsoluteConfigPath(t *testing.T) {
	require.NoError(t, (&Config{ConfigPath: t.TempDir()}).ValidateConfigPath())
}
