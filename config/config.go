package config

import (
	"os"
)

type Config struct {
	DBType     string
	DBName     string
	DBPassword string
	ConfigPath string
	DataPath   string
	ListenPort string
	Version    string
}

func Load() *Config {
	return &Config{
		DBType:     getEnv("DATABASE_TYPE", "SQLite"),
		DBName:     getEnv("DATABASE_NAME", "bbank"),
		DBPassword: getEnv("DATABASE_PASSWORD", ""),
		ConfigPath: getEnv("CONFIG_PATH", "/config"),
		DataPath:   getEnv("DATA_PATH", "/data"),
		ListenPort: getEnv("LISTEN_PORT", "8585"),
		Version:    "0.0.1",
	}
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
