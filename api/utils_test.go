package api

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNiceSeconds(t *testing.T) {
	wantOne := "22d 7h 39m 31s"
	wantNA := "N/A"

	niceOne := niceSeconds(1928371)
	niceNA := niceSeconds(0)

	assert.Equal(t, wantOne, niceOne, "should be nice seconds")
	assert.Equal(t, wantNA, niceNA, "should be nice NA")
}

func TestNiceNumbers(t *testing.T) {
	wantMillions := "198M"
	wantThousands := "19.8k"
	wantThousandsTwo := "1.98k"
	wantZero := "0"

	niceMillions := niceNumbers(198236461)
	niceThousands := niceNumbers(19823)
	niceThousandsTwo := niceNumbers(1984)
	niceZero := niceNumbers(0)

	assert.Equal(t, wantMillions, niceMillions, "should be nice millions")
	assert.Equal(t, wantThousands, niceThousands, "should be nice thousands")
	assert.Equal(t, wantThousandsTwo, niceThousandsTwo, "should be nice thousands")
	assert.Equal(t, wantZero, niceZero, "should be nice zero")
}
