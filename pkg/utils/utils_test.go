package utils

import (
	"testing"
)

func TestTernary(t *testing.T) {
	// Test true condition
	result := Ternary(true, 42, 13)
	if result != 42 {
		t.Errorf("Expected 42, got %d", result)
	}

	// Test false condition
	result = Ternary(false, 42, 13)
	if result != 13 {
		t.Errorf("Expected 13, got %d", result)
	}
}

func TestFirstNonZero(t *testing.T) {
	// Test with int values
	result := FirstNonZero(0, 0, 42, 13)
	if result != 42 {
		t.Errorf("Expected 42, got %d", result)
	}

	// Test with string values
	resultStr := FirstNonZero("", "", "hello")
	if resultStr != "hello" {
		t.Errorf("Expected hello, got %s", resultStr)
	}

	// Test all zero values (strings)
	zeroResultStr := FirstNonZero("")
	if zeroResultStr != "" {
		t.Errorf("Expected empty string, got %s", zeroResultStr)
	}

	// Test with float values
	floatResult := FirstNonZero(0.0, 0.0, 3.14)
	if floatResult != 3.14 {
		t.Errorf("Expected 3.14, got %f", floatResult)
	}
}