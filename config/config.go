package config

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"

	log "github.com/sirupsen/logrus"
)

type Config struct {
	// Server Config
	Version        string
	ListenHost     string
	ListenPort     string
	PublicOrigin   string
	TrustedProxies []string

	// DB Configuration
	DBType string
	DBName string

	// Data Paths
	ConfigPath string
	DataPath   string

	// Miscellaneous Settings
	RegistrationEnabled bool
	DemoMode            bool
	LogLevel            string

	// Cookie Settings
	CookieAuthKey string
	CookieEncKey  string

	HardcoverClientID     string
	HardcoverClientSecret string
	HardcoverTokenKey     string
	hardcoverCatalogToken string
}

func (c *Config) HardcoverCatalogToken() string { return c.hardcoverCatalogToken }

type customFormatter struct {
	log.Formatter
}

// Force UTC & Set type (app)
func (cf customFormatter) Format(e *log.Entry) ([]byte, error) {
	if e.Data["type"] == nil {
		e.Data["type"] = "app"
	}
	e.Time = e.Time.UTC()
	return cf.Formatter.Format(e)
}

// Set at runtime
var version string = "develop"

func Load() (*Config, error) {
	c := &Config{
		Version:               version,
		PublicOrigin:          strings.TrimSpace(getEnv("PUBLIC_ORIGIN", "")),
		ConfigPath:            getEnv("CONFIG_PATH", "/config"),
		DataPath:              getEnv("DATA_PATH", "/data"),
		ListenHost:            strings.TrimSpace(getEnv("LISTEN_HOST", "")),
		ListenPort:            getEnv("LISTEN_PORT", "8585"),
		DBType:                trimLowerString(getEnv("DATABASE_TYPE", "SQLite")),
		DBName:                trimLowerString(getEnv("DATABASE_NAME", "antholume")),
		RegistrationEnabled:   trimLowerString(getEnv("REGISTRATION_ENABLED", "false")) == "true",
		DemoMode:              trimLowerString(getEnv("DEMO_MODE", "false")) == "true",
		CookieAuthKey:         trimLowerString(getEnv("COOKIE_AUTH_KEY", "")),
		CookieEncKey:          trimLowerString(getEnv("COOKIE_ENC_KEY", "")),
		LogLevel:              trimLowerString(getEnv("LOG_LEVEL", "info")),
		HardcoverClientID:     getEnv("HARDCOVER_CLIENT_ID", ""),
		HardcoverClientSecret: getEnv("HARDCOVER_CLIENT_SECRET", ""),
		HardcoverTokenKey:     getEnv("HARDCOVER_TOKEN_KEY", ""),
		hardcoverCatalogToken: strings.TrimSpace(getEnv("HARDCOVER_CATALOG_TOKEN", "")),
	}

	if err := c.ValidateConfigPath(); err != nil {
		return nil, err
	}

	for _, proxy := range strings.Split(getEnv("TRUSTED_PROXIES", ""), ",") {
		if proxy = strings.TrimSpace(proxy); proxy != "" {
			c.TrustedProxies = append(c.TrustedProxies, proxy)
		}
	}

	// Parse log level
	logLevel, err := log.ParseLevel(c.LogLevel)
	if err != nil {
		logLevel = log.InfoLevel
	}

	// Create custom formatter
	logFormatter := &customFormatter{&log.JSONFormatter{
		CallerPrettyfier: prettyCaller,
	}}

	// Create log rotator
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

	// Rotate now
	rotateFileHook.Rotate()

	// Set logger settings
	log.SetLevel(logLevel)
	log.SetFormatter(logFormatter)
	log.SetReportCaller(true)
	log.AddHook(rotateFileHook)

	// Ensure directories exist
	c.EnsureDirectories()

	return c, nil
}

func (c *Config) ValidateConfigPath() error {
	if !filepath.IsAbs(c.ConfigPath) {
		return fmt.Errorf("CONFIG_PATH must be an absolute path: %q", c.ConfigPath)
	}
	return nil
}

// Ensures needed directories exist
func (c *Config) EnsureDirectories() {
	os.Mkdir(c.ConfigPath, 0755)
	os.Mkdir(c.DataPath, 0755)

	docDir := filepath.Join(c.DataPath, "documents")
	coversDir := filepath.Join(c.DataPath, "covers")

	os.Mkdir(docDir, 0755)
	os.Mkdir(coversDir, 0755)
	os.Mkdir(filepath.Join(c.DataPath, "imports"), 0750)
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

	return functionName, fileName
}
