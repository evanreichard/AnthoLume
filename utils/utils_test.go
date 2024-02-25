package utils

import (
	"github.com/stretchr/testify/assert"
	"testing"
)

func TestCalculatePartialMD5(t *testing.T) {
	assert := assert.New(t)

	desiredPartialMD5 := "386d1cb51fe4a72e5c9fdad5e059bad9"
	calculatedPartialMD5, err := CalculatePartialMD5("../_test_files/alice.epub")

	assert.Nil(err, "error should be nil")
	assert.Equal(desiredPartialMD5, *calculatedPartialMD5, "should be equal")
}

func TestCalculateMD5(t *testing.T) {
	assert := assert.New(t)

	desiredMD5 := "0f36c66155de34b281c4791654d0b1ce"
	calculatedMD5, err := CalculateMD5("../_test_files/alice.epub")

	assert.Nil(err, "error should be nil")
	assert.Equal(desiredMD5, *calculatedMD5, "should be equal")
}
