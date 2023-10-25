package api

import "testing"

func TestNiceSeconds(t *testing.T) {
	want := "22d 7h 39m 31s"
	nice := niceSeconds(1928371)

	if nice != want {
		t.Fatalf(`Expected: %v, Got: %v`, want, nice)
	}
}
