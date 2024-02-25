package config

import (
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLoadConfig(t *testing.T) {
	conf := Load()
	assert.Equal(t, "sqlite", conf.DBType)
}

func TestGetEnvDefault(t *testing.T) {
	desiredValue := "def_val"
	envDefault := getEnv("DEFAULT_TEST", desiredValue)

	assert.Equal(t, desiredValue, envDefault)
}

func TestTrimLowerString(t *testing.T) {
	desiredValue := "trimtest"
	outputValue := trimLowerString(" trimTest ")

	assert.Equal(t, desiredValue, outputValue)
}

func TestPrettyCaller(t *testing.T) {
	p, _, _, _ := runtime.Caller(0)
	result := runtime.CallersFrames([]uintptr{p})
	f, _ := result.Next()
	functionName, fileName := prettyCaller(&f)

	assert.Equal(t, "TestPrettyCaller", functionName, "should have current function name")
	assert.Equal(t, "config/config_test.go@30", fileName, "should have current file path and line number")
}
