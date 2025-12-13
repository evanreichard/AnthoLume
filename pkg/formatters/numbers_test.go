package formatters

import (
    "testing"
)

func TestFormatNumber(t *testing.T) {
    tests := []struct {
        input int64
        want  string
    }{
        {0, "0"},
        {19823, "19.8k"},
        {1500000, "1.50M"},
        {-12345, "-12.3k"},
    }
    for _, tc := range tests {
        if got := FormatNumber(tc.input); got != tc.want {
            t.Errorf("FormatNumber(%d) = %s, want %s", tc.input, got, tc.want)
        }
    }
}