package formatters

import (
    "testing"
    "time"
)

func TestFormatDuration(t *testing.T) {
    tests := []struct {
        dur  time.Duration
        want string
    }{
        {0, "N/A"},
        {22*24*time.Hour + 7*time.Hour + 39*time.Minute + 31*time.Second, "22d 7h 39m 31s"},
        {5*time.Minute + 15*time.Second, "5m 15s"},
    }
    for _, tc := range tests {
        if got := FormatDuration(tc.dur); got != tc.want {
            t.Errorf("FormatDuration(%v) = %s, want %s", tc.dur, got, tc.want)
        }
    }
}
