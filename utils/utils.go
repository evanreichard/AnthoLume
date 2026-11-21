package utils

import (
	"crypto/md5"
	"crypto/rand"
	"fmt"
	"io"
	"os"
)

// Reimplemented KOReader Partial MD5 Calculation
func CalculatePartialMD5(filePath string) (*string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}

	defer file.Close()
	return CalculatePartialMD5Reader(file)
}

func CalculatePartialMD5Reader(file io.ReaderAt) (*string, error) {
	const sampleSize = 1024
	var sample [sampleSize]byte
	hash := md5.New()
	for i := -1; i <= 10; i++ {
		var offset int64
		if i >= 0 {
			offset = int64(sampleSize) << (2 * i)
		}
		n, err := file.ReadAt(sample[:], offset)
		if err != nil && err != io.EOF {
			return nil, err
		}
		// KOReader hashes short final samples, which ReadAt returns alongside EOF.
		hash.Write(sample[:n])
		if err == io.EOF {
			break
		}
	}
	fileHash := fmt.Sprintf("%x", hash.Sum(nil))
	return &fileHash, nil
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

// Calculate MD5 of a file
func CalculateMD5(filePath string) (*string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}

	defer file.Close()
	return CalculateMD5Reader(file)
}

func CalculateMD5Reader(file io.Reader) (*string, error) {
	hash := md5.New()
	_, err := io.Copy(hash, file)
	if err != nil {
		return nil, err
	}

	fileHash := fmt.Sprintf("%x", hash.Sum(nil))

	return &fileHash, nil
}
