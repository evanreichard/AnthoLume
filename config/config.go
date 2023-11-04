package config

import (
	"os"
	"strings"
)

type Config struct {
	// Server Config
	Version    string
	ListenPort string

	// DB Configuration
	DBType string
	DBName string

	// Data Paths
	ConfigPath string
	DataPath   string

	// Miscellaneous Settings
	RegistrationEnabled bool
	SearchEnabled       bool
	DemoMode            bool

	// Cookie Settings
	CookieSessionKey string
	CookieSecure     bool
	CookieHTTPOnly   bool
}

func Load() *Config {
	return &Config{
		Version:             "0.0.2",
		DBType:              trimLowerString(getEnv("DATABASE_TYPE", "SQLite")),
		DBName:              trimLowerString(getEnv("DATABASE_NAME", "antholume")),
		ConfigPath:          getEnv("CONFIG_PATH", "/config"),
		DataPath:            getEnv("DATA_PATH", "/data"),
		ListenPort:          getEnv("LISTEN_PORT", "8585"),
		RegistrationEnabled: trimLowerString(getEnv("REGISTRATION_ENABLED", "false")) == "true",
		DemoMode:            trimLowerString(getEnv("DEMO_MODE", "false")) == "true",
		SearchEnabled:       trimLowerString(getEnv("SEARCH_ENABLED", "false")) == "true",
		CookieSessionKey:    trimLowerString(getEnv("COOKIE_SESSION_KEY", "")),
		CookieSecure:        trimLowerString(getEnv("COOKIE_SECURE", "true")) == "true",
		CookieHTTPOnly:      trimLowerString(getEnv("COOKIE_HTTP_ONLY", "true")) == "true",
	}
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func trimLowerString(val string) string {
	return strings.ToLower(strings.TrimSpace(val))
}
