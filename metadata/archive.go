package metadata

import (
	"archive/zip"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/gabriel-vasile/mimetype"
)

var (
	ErrUnsupportedFileType = errors.New("unsupported file type; upload an EPUB")
	ErrInvalidDocument     = errors.New("invalid EPUB document")
	ErrArchiveTooLarge     = errors.New("EPUB exceeds archive safety limits")
)

const (
	MaxDocumentSize            = 64 << 20
	maxArchiveEntries          = 10000
	maxArchiveEntrySize        = 64 << 20
	maxArchiveUncompressed     = 256 << 20
	maxArchiveCompressionRatio = 1000
	maxEPUBTextSize            = 8 << 20
)

func detectDocumentType(path string) (DocumentType, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return "", err
	}
	if stat.Size() > MaxDocumentSize {
		return "", ErrArchiveTooLarge
	}
	mime, err := mimetype.DetectReader(f)
	if err != nil {
		return "", err
	}
	if !mime.Is("application/zip") && !mime.Is("application/epub+zip") {
		return "", ErrUnsupportedFileType
	}
	if err := checkZIPDirectory(f, stat.Size()); err != nil {
		return "", err
	}
	z, err := zip.NewReader(f, stat.Size())
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidDocument, err)
	}
	if err := checkArchiveLimits(z); err != nil {
		return "", err
	}
	for _, entry := range z.File {
		if entry.Name != "mimetype" {
			continue
		}
		if entry.UncompressedSize64 != uint64(len("application/epub+zip")) {
			return "", ErrUnsupportedFileType
		}
		r, err := entry.Open()
		if err != nil {
			return "", fmt.Errorf("%w: %v", ErrInvalidDocument, err)
		}
		data, err := io.ReadAll(io.LimitReader(r, 20))
		r.Close()
		if err != nil {
			return "", fmt.Errorf("%w: %v", ErrInvalidDocument, err)
		}
		if string(data) != "application/epub+zip" {
			return "", ErrUnsupportedFileType
		}
		return TYPE_EPUB, nil
	}
	return "", ErrUnsupportedFileType
}

// Bound Directory Allocation - archive/zip builds its entry index before callers can check entry counts.
func checkZIPDirectory(r io.ReaderAt, size int64) error {
	length := min(size, 22+65535)
	tail := make([]byte, length)
	if _, err := r.ReadAt(tail, size-length); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidDocument, err)
	}
	for i := len(tail) - 22; i >= 0; i-- {
		if string(tail[i:i+4]) != "PK\x05\x06" || i+22+int(binary.LittleEndian.Uint16(tail[i+20:])) != len(tail) {
			continue
		}
		count := binary.LittleEndian.Uint16(tail[i+10:])
		directorySize := int64(binary.LittleEndian.Uint32(tail[i+12:]))
		directoryOffset := binary.LittleEndian.Uint32(tail[i+16:])
		if count > maxArchiveEntries || directorySize > 16<<20 || directoryOffset == 0xffffffff {
			return ErrArchiveTooLarge
		}
		end := size - length + int64(i)
		pos := end - directorySize
		if pos < 0 {
			return ErrInvalidDocument
		}
		var header [46]byte
		actual := 0
		for pos < end {
			if actual >= maxArchiveEntries {
				return ErrArchiveTooLarge
			}
			if _, err := r.ReadAt(header[:], pos); err != nil || string(header[:4]) != "PK\x01\x02" {
				return ErrInvalidDocument
			}
			pos += 46 + int64(binary.LittleEndian.Uint16(header[28:])) + int64(binary.LittleEndian.Uint16(header[30:])) + int64(binary.LittleEndian.Uint16(header[32:]))
			actual++
		}
		if pos != end || actual != int(count) {
			return ErrInvalidDocument
		}
		return nil
	}
	return ErrInvalidDocument
}

func checkArchiveLimits(z *zip.Reader) error {
	if len(z.File) > maxArchiveEntries {
		return ErrArchiveTooLarge
	}
	var total uint64
	names := make(map[string]bool, len(z.File))
	for _, entry := range z.File {
		if names[entry.Name] {
			return fmt.Errorf("%w: duplicate ZIP entry", ErrInvalidDocument)
		}
		names[entry.Name] = true
		size := entry.UncompressedSize64
		if size > maxArchiveEntrySize || size > maxArchiveUncompressed-total {
			return ErrArchiveTooLarge
		}
		total += size
		if size > 0 && (entry.CompressedSize64 == 0 || size/entry.CompressedSize64 > maxArchiveCompressionRatio) {
			return ErrArchiveTooLarge
		}
	}
	return nil
}

func validateEPUBArchive(path string) error {
	if _, err := detectDocumentType(path); err != nil {
		return err
	}
	z, err := zip.OpenReader(path)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidDocument, err)
	}
	defer z.Close()
	container, err := z.Open("META-INF/container.xml")
	if err != nil {
		return fmt.Errorf("%w: missing container.xml", ErrInvalidDocument)
	}
	data, err := io.ReadAll(io.LimitReader(container, maxEPUBTextSize+1))
	container.Close()
	if len(data) > maxEPUBTextSize {
		return ErrArchiveTooLarge
	}
	if err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidDocument, err)
	}
	var directory struct {
		Rootfiles []struct {
			FullPath string `xml:"full-path,attr"`
		} `xml:"rootfiles>rootfile"`
	}
	if err := xml.Unmarshal(data, &directory); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidDocument, err)
	}
	if len(directory.Rootfiles) == 0 {
		return fmt.Errorf("%w: missing rootfile", ErrInvalidDocument)
	}
	if len(directory.Rootfiles) > 16 {
		return ErrArchiveTooLarge
	}
	for _, root := range directory.Rootfiles {
		found := false
		for _, entry := range z.File {
			if entry.Name == root.FullPath {
				found = true
				if entry.UncompressedSize64 > maxEPUBTextSize {
					return ErrArchiveTooLarge
				}
			}
		}
		if !found {
			return fmt.Errorf("%w: missing rootfile", ErrInvalidDocument)
		}
	}
	var total int64
	// Verify Expanded Data - ZIP size declarations alone are not trustworthy; check bounded reads and CRCs before parsing.
	for _, entry := range z.File {
		r, err := entry.Open()
		if err != nil {
			return fmt.Errorf("%w: %v", ErrInvalidDocument, err)
		}
		n, err := io.Copy(io.Discard, io.LimitReader(r, maxArchiveEntrySize+1))
		r.Close()
		total += n
		if n > maxArchiveEntrySize || total > maxArchiveUncompressed {
			return ErrArchiveTooLarge
		}
		if err != nil {
			return fmt.Errorf("%w: %v", ErrInvalidDocument, err)
		}
	}
	return nil
}
