package ptr

import (
	"testing"
)

func TestOf(t *testing.T) {
	// Test with different types
	intVal := 42
	intPtr := Of(intVal)
	if *intPtr != intVal {
		t.Errorf("Expected %d, got %d", intVal, *intPtr)
	}

	stringVal := "hello"
	stringPtr := Of(stringVal)
	if *stringPtr != stringVal {
		t.Errorf("Expected %s, got %s", stringVal, *stringPtr)
	}

	floatVal := 3.14
	floatPtr := Of(floatVal)
	if *floatPtr != floatVal {
		t.Errorf("Expected %f, got %f", floatVal, *floatPtr)
	}
}

func TestDeref(t *testing.T) {
	// Test with non-nil pointer
	intVal := 42
	intPtr := Of(intVal)
	result := Deref(intPtr)
	if result != intVal {
		t.Errorf("Expected %d, got %d", intVal, result)
	}

	// Test with nil pointer
	var nilPtr *int
	result = Deref(nilPtr)
	if result != 0 {
		t.Errorf("Expected 0, got %d", result)
	}

	// Test with string
	stringVal := "hello"
	stringPtr := Of(stringVal)
	resultStr := Deref(stringPtr)
	if resultStr != stringVal {
		t.Errorf("Expected %s, got %s", stringVal, resultStr)
	}

	// Test with nil string pointer
	var nilStrPtr *string
	resultStr = Deref(nilStrPtr)
	if resultStr != "" {
		t.Errorf("Expected empty string, got %s", resultStr)
	}
}

func TestDerefZeroValue(t *testing.T) {
	// Test that Deref returns zero value for nil pointers
	var nilInt *int
	result := Deref(nilInt)
	if result != 0 {
		t.Errorf("Expected zero int, got %d", result)
	}

	var nilString *string
	resultStr := Deref(nilString)
	if resultStr != "" {
		t.Errorf("Expected zero string, got %s", resultStr)
	}
}
