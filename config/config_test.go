package config

import "testing"

func TestLoadConfig(t *testing.T) {
	conf := Load()
	want := "sqlite"
	if conf.DBType != want {
		t.Fatalf(`Load().DBType = %q, want match for %#q, nil`, conf.DBType, want)
	}
}

func TestGetEnvDefault(t *testing.T) {
	want := "def_val"
	envDefault := getEnv("DEFAULT_TEST", want)
	if envDefault != want {
		t.Fatalf(`getEnv("DEFAULT_TEST", "def_val") = %q, want match for %#q, nil`, envDefault, want)
	}
}

func TestGetEnvSet(t *testing.T) {
	envDefault := getEnv("SET_TEST", "not_this")
	want := "set_val"
	if envDefault != want {
		t.Fatalf(`getEnv("SET_TEST", "not_this") = %q, want match for %#q, nil`, envDefault, want)
	}
}

func TestTrimLowerString(t *testing.T) {
	want := "trimtest"
	output := trimLowerString(" trimTest ")
	if output != want {
		t.Fatalf(`trimLowerString(" trimTest ") = %q, want match for %#q, nil`, output, want)
	}
}
