package config

import (
	"fmt"
	"os"
	"path"
	"runtime"
	"strings"

	log "github.com/sirupsen/logrus"
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
	CookieAuthKey  string
	CookieEncKey   string
	CookieSecure   bool
	CookieHTTPOnly bool
}

type customFormatter struct {
	log.Formatter
}

// Force UTC & Set Type (app)
func (cf customFormatter) Format(e *log.Entry) ([]byte, error) {
	if e.Data["type"] == nil {
		e.Data["type"] = "app"
	}
	e.Time = e.Time.UTC()
	return cf.Formatter.Format(e)
}

// Set at runtime
var version string = "develop"

func Load() *Config {
	c := &Config{
		Version:             version,
		ConfigPath:          getEnv("CONFIG_PATH", "/config"),
		DataPath:            getEnv("DATA_PATH", "/data"),
		ListenPort:          getEnv("LISTEN_PORT", "8585"),
		DBType:              trimLowerString(getEnv("DATABASE_TYPE", "SQLite")),
		DBName:              trimLowerString(getEnv("DATABASE_NAME", "antholume")),
		RegistrationEnabled: trimLowerString(getEnv("REGISTRATION_ENABLED", "false")) == "true",
		DemoMode:            trimLowerString(getEnv("DEMO_MODE", "false")) == "true",
		SearchEnabled:       trimLowerString(getEnv("SEARCH_ENABLED", "false")) == "true",
		CookieAuthKey:       trimLowerString(getEnv("COOKIE_AUTH_KEY", "")),
		CookieEncKey:        trimLowerString(getEnv("COOKIE_ENC_KEY", "")),
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
	logFormatter := &customFormatter{&log.JSONFormatter{
		CallerPrettyfier: prettyCaller,
	}}

	// Log Rotater
	rotateFileHook, err := NewRotateFileHook(RotateFileConfig{
		Filename:   path.Join(c.ConfigPath, "logs/antholume.log"),
		MaxSize:    50,
		MaxBackups: 3,
		MaxAge:     30,
		Level:      logLevel,
		Formatter:  logFormatter,
	})
	if err != nil {
		log.Fatal("Unable to initialize file rotate hook")
	}

	// Rotate Now
	rotateFileHook.Rotate()

	log.SetLevel(logLevel)
	log.SetFormatter(logFormatter)
	log.SetReportCaller(true)
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

func prettyCaller(f *runtime.Frame) (function string, file string) {
	purgePrefix := "reichard.io/antholume/"

	pathName := strings.Replace(f.Func.Name(), purgePrefix, "", 1)
	parts := strings.Split(pathName, ".")

	filepath, line := f.Func.FileLine(f.PC)
	splitFilePath := strings.Split(filepath, "/")

	fileName := fmt.Sprintf("%s/%s@%d", parts[0], splitFilePath[len(splitFilePath)-1], line)
	functionName := strings.Replace(pathName, parts[0]+".", "", 1)

	// Exclude GIN Logger
	if functionName == "NewApi.apiLogger.func1" {
		fileName = ""
		functionName = ""
	}

	return functionName, fileName
}
