package config

import (
	"github.com/sirupsen/logrus"
	"gopkg.in/natefinch/lumberjack.v2"
)

// Modified "snowzach/rotatefilehook" to support manual rotation

type RotateFileConfig struct {
	Filename   string
	MaxSize    int
	MaxBackups int
	MaxAge     int
	Compress   bool
	Level      logrus.Level
	Formatter  logrus.Formatter
}

type RotateFileHook struct {
	Config    RotateFileConfig
	logWriter *lumberjack.Logger
}

func NewRotateFileHook(config RotateFileConfig) (*RotateFileHook, error) {
	hook := RotateFileHook{
		Config: config,
	}
	hook.logWriter = &lumberjack.Logger{
		Filename:   config.Filename,
		MaxSize:    config.MaxSize,
		MaxBackups: config.MaxBackups,
		MaxAge:     config.MaxAge,
		Compress:   config.Compress,
	}
	return &hook, nil
}

func (hook *RotateFileHook) Rotate() error {
	return hook.logWriter.Rotate()
}

func (hook *RotateFileHook) Levels() []logrus.Level {
	return logrus.AllLevels[:hook.Config.Level+1]
}

func (hook *RotateFileHook) Fire(entry *logrus.Entry) (err error) {
	b, err := hook.Config.Formatter.Format(entry)
	if err != nil {
		return err
	}
	hook.logWriter.Write(b)
	return nil
}
