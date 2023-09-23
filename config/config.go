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
	DBType     string
	DBName     string
	DBPassword string

	// Data Paths
	ConfigPath string
	DataPath   string

	// Miscellaneous Settings
	RegistrationEnabled bool
	CookieSessionKey    string
}

func Load() *Config {
	return &Config{
		Version:             "0.0.1",
		DBType:              trimLowerString(getEnv("DATABASE_TYPE", "SQLite")),
		DBName:              trimLowerString(getEnv("DATABASE_NAME", "book_manager")),
		DBPassword:          getEnv("DATABASE_PASSWORD", ""),
		ConfigPath:          getEnv("CONFIG_PATH", "/config"),
		DataPath:            getEnv("DATA_PATH", "/data"),
		ListenPort:          getEnv("LISTEN_PORT", "8585"),
		CookieSessionKey:    trimLowerString(getEnv("COOKIE_SESSION_KEY", "")),
		RegistrationEnabled: trimLowerString(getEnv("REGISTRATION_ENABLED", "false")) == "true",
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
