package config

import (
	"os"
	"path"
	"strings"

	log "github.com/sirupsen/logrus"
	"github.com/snowzach/rotatefilehook"
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
	LogLevel            string

	// Cookie Settings
	CookieSessionKey string
	CookieSecure     bool
	CookieHTTPOnly   bool
}

type UTCFormatter struct {
	log.Formatter
}

func (u UTCFormatter) Format(e *log.Entry) ([]byte, error) {
	e.Time = e.Time.UTC()
	return u.Formatter.Format(e)
}

// Set at runtime
var version string = "develop"

func Load() *Config {
	c := &Config{
		Version:             version,
		DBType:              trimLowerString(getEnv("DATABASE_TYPE", "SQLite")),
		DBName:              trimLowerString(getEnv("DATABASE_NAME", "antholume")),
		ConfigPath:          getEnv("CONFIG_PATH", "/config"),
		DataPath:            getEnv("DATA_PATH", "/data"),
		ListenPort:          getEnv("LISTEN_PORT", "8585"),
		RegistrationEnabled: trimLowerString(getEnv("REGISTRATION_ENABLED", "false")) == "true",
		DemoMode:            trimLowerString(getEnv("DEMO_MODE", "false")) == "true",
		SearchEnabled:       trimLowerString(getEnv("SEARCH_ENABLED", "false")) == "true",
		CookieSessionKey:    trimLowerString(getEnv("COOKIE_SESSION_KEY", "")),
		LogLevel:            trimLowerString(getEnv("LOG_LEVEL", "info")),
		CookieSecure:        trimLowerString(getEnv("COOKIE_SECURE", "true")) == "true",
		CookieHTTPOnly:      trimLowerString(getEnv("COOKIE_HTTP_ONLY", "true")) == "true",
	}

	// Log Level
	logLevel, err := log.ParseLevel(c.LogLevel)
	if err != nil {
		logLevel = log.InfoLevel
	}

	// Log Formatter
	ttyLogFormatter := &UTCFormatter{&log.TextFormatter{FullTimestamp: true}}
	fileLogFormatter := &UTCFormatter{&log.TextFormatter{FullTimestamp: true, DisableColors: true}}

	// Log Rotater
	rotateFileHook, err := rotatefilehook.NewRotateFileHook(rotatefilehook.RotateFileConfig{
		Filename:   path.Join(c.ConfigPath, "logs/antholume.log"),
		MaxSize:    50,
		MaxBackups: 3,
		MaxAge:     30,
		Level:      logLevel,
		Formatter:  fileLogFormatter,
	})
	if err != nil {
		log.Fatal("[config.Load] Unable to initialize file rotate hook")
	}

	log.SetLevel(logLevel)
	log.SetFormatter(ttyLogFormatter)
	log.AddHook(rotateFileHook)

	return c
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
