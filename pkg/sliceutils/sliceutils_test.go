package sliceutils

import (
	"testing"
)

func TestFirst(t *testing.T) {
	// Test with empty slice
	var empty []int
	result, ok := First(empty)
	if ok != false {
		t.Errorf("Expected ok=false for empty slice, got %v", ok)
	}
	if result != 0 {
		t.Errorf("Expected zero value for empty slice, got %v", result)
	}

	// Test with non-empty slice
	testSlice := []int{1, 2, 3}
	result, ok = First(testSlice)
	if ok != true {
		t.Errorf("Expected ok=true for non-empty slice, got %v", ok)
	}
	if result != 1 {
		t.Errorf("Expected first element, got %v", result)
	}
}

func TestMap(t *testing.T) {
	// Test with empty slice
	var empty []int
	result := Map(empty, func(x int) int { return x * 2 })
	if len(result) != 0 {
		t.Errorf("Expected empty result for empty input, got %v", result)
	}

	// Test with non-empty slice
	testSlice := []int{1, 2, 3}
	result = Map(testSlice, func(x int) int { return x * 2 })
	expected := []int{2, 4, 6}
	if len(result) != len(expected) {
		t.Errorf("Expected length %d, got %d", len(expected), len(result))
	}
	for i, v := range result {
		if v != expected[i] {
			t.Errorf("Expected %d at index %d, got %d", expected[i], i, v)
		}
	}
}

