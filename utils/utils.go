package utils

import (
	"bytes"
	"crypto/md5"
	"crypto/rand"
	"fmt"
	"io"
	"os"
)

// Reimplemented KOReader Partial MD5 Calculation
func CalculatePartialMD5(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}

	defer file.Close()

	var step int64 = 1024
	var size int64 = 1024
	var buf bytes.Buffer

	for i := -1; i <= 10; i++ {
		byteStep := make([]byte, size)

		var newShift int64 = int64(i * 2)
		var newOffset int64
		if i == -1 {
			newOffset = 0
		} else {
			newOffset = step << newShift
		}

		_, err := file.ReadAt(byteStep, newOffset)
		if err == io.EOF {
			break
		}
		buf.Write(byteStep)
	}

	allBytes := buf.Bytes()
	return fmt.Sprintf("%x", md5.Sum(allBytes)), nil
}

// Creates a token of n size
func GenerateToken(n int) ([]byte, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	if err != nil {
		return nil, err
	}
	return b, nil
}
