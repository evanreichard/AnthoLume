package utils

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCalculatePartialMD5(t *testing.T) {
	assert := assert.New(t)

	desiredPartialMD5 := "386d1cb51fe4a72e5c9fdad5e059bad9"
	calculatedPartialMD5, err := CalculatePartialMD5("../_test_files/alice.epub")

	assert.Nil(err, "error should be nil")
	assert.Equal(desiredPartialMD5, *calculatedPartialMD5, "should be equal")
}

func TestCalculatePartialMD5MatchesKOReaderSampleBoundaries(t *testing.T) {
	// Upstream Vectors - These match the KOReader oracle in web/src/reading/tests/browser/source-integrity.spec.ts.
	for _, tc := range []struct {
		size int
		want string
	}{
		{1, "93b885adfe0da089cdf634904fd59f71"},
		{1024, "19fa36fd104d1b15e6e46b88444a9e73"},
		{1025, "2e5f71dc221b0ae96c5dc92c72c9245e"},
		{4096, "8119cf688ab6667c062155ed2db805f3"},
		{4097, "6eb50ffd1fa15a300c6983d11d35ada5"},
		{262145, "45980c72b809c69ddbe99918955a880b"},
	} {
		data := make([]byte, tc.size)
		for i := range data {
			data[i] = byte(i*31 + i/251)
		}
		got, err := CalculatePartialMD5Reader(bytes.NewReader(data))
		require.NoError(t, err)
		require.Equal(t, tc.want, *got, "file size %d", tc.size)
	}
}

func TestCalculateMD5(t *testing.T) {
	assert := assert.New(t)

	desiredMD5 := "0f36c66155de34b281c4791654d0b1ce"
	calculatedMD5, err := CalculateMD5("../_test_files/alice.epub")

	assert.Nil(err, "error should be nil")
	assert.Equal(desiredMD5, *calculatedMD5, "should be equal")
}
