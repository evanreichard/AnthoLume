package hardcover

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"math/rand/v2"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"reichard.io/antholume/metadata"
)

func TestCatalogCoverSelection(t *testing.T) {
	for _, tc := range []struct {
		name, bookImage, editionImage string
		previewEdition                bool
		wantID                        int64
	}{
		{"book", `{"id":12}`, `null`, false, 12},
		{"edition preferred", `{"id":12}`, `{"id":99}`, true, 99},
		{"book fallback", `{"id":12}`, `null`, true, 12},
		{"invalid edition image", `{"id":12}`, `{"id":10000000000}`, true, 12},
		{"neither", `null`, `null`, true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := testCatalog(t, func(w http.ResponseWriter, r catalogRequest) {
				assert.Contains(t, r.Query, "image { id }")
				book := fmt.Sprintf(`{"id":42,"title":"Book","image":%s}`, tc.bookImage)
				if tc.previewEdition {
					fmt.Fprintf(w, `{"data":{"editions":[{"id":77,"image":%s,"book":%s}]}}`, tc.editionImage, book)
				} else {
					fmt.Fprintf(w, `{"data":{"books":[%s]}}`, book)
				}
			})
			var edition string
			if tc.previewEdition {
				edition = "77"
			}
			m, err := c.Resolve(t.Context(), "42", edition, "")
			require.NoError(t, err)
			if tc.wantID == 0 {
				require.Nil(t, m.CoverID)
			} else {
				require.NotNil(t, m.CoverID)
				require.Equal(t, tc.wantID, *m.CoverID)
			}
		})
	}
}

type coverTransport func(*http.Request) (*http.Response, error)

func (transport coverTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return transport(r)
}

func TestCatalogCoverFetch(t *testing.T) {
	const asset = "https://assets.hardcover.app/edition/77/cover"
	var pngCover bytes.Buffer
	require.NoError(t, png.Encode(&pngCover, image.NewRGBA(image.Rect(0, 0, 2, 3))))
	var jpegCover bytes.Buffer
	require.NoError(t, jpeg.Encode(&jpegCover, image.NewRGBA(image.Rect(0, 0, 2, 3)), nil))
	var oversizedDimensions bytes.Buffer
	require.NoError(t, png.Encode(&oversizedDimensions, image.NewRGBA(image.Rect(0, 0, maxCoverSide+1, 2))))
	// A 2 × 2 transparent VP8L fixture, independently of any installed image tools.
	webpCover, err := base64.StdEncoding.DecodeString("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAEAfQ//73v/+BiOh/AAA=")
	require.NoError(t, err)
	for _, tc := range []struct {
		name, url      string
		input, rowID   int64
		status         int
		body           []byte
		assetRequested bool
		wantErr        error
	}{
		{"jpeg", asset, 12, 12, 200, jpegCover.Bytes(), true, nil},
		{"png", asset, 12, 12, 200, pngCover.Bytes(), true, nil},
		{"webp", asset, 12, 12, 200, webpCover, true, nil},
		{"bad id", asset, 10000000000, 12, 200, nil, false, metadata.ErrLookupCoverMissing},
		{"wrong row", asset, 12, 13, 200, nil, false, metadata.ErrLookupCoverMissing},
		{"external host", "https://other.example/cover", 12, 12, 200, nil, false, metadata.ErrLookupCoverMissing},
		{"lookalike host", "https://assets.hardcover.app.evil.example/cover", 12, 12, 200, nil, false, metadata.ErrLookupCoverMissing},
		{"HTTP", "http://assets.hardcover.app/cover", 12, 12, 200, nil, false, metadata.ErrLookupCoverMissing},
		{"port", "https://assets.hardcover.app:444/cover", 12, 12, 200, nil, false, metadata.ErrLookupCoverMissing},
		{"userinfo", "https://user:secret@assets.hardcover.app/cover", 12, 12, 200, nil, false, metadata.ErrLookupCoverMissing},
		{"redirect", asset, 12, 12, 302, nil, true, metadata.ErrLookupCoverMissing},
		{"missing image", asset, 12, 12, 404, nil, true, metadata.ErrLookupCoverMissing},
		{"upstream failed", asset, 12, 12, 503, nil, true, ErrProvider},
		{"too many bytes with no Content-Length", asset, 12, 12, 200, bytes.Repeat([]byte{1}, maxCoverSource+1), true, metadata.ErrLookupCoverMissing},
		{"invalid image", asset, 12, 12, 200, []byte(`<svg/>`), true, metadata.ErrLookupCoverMissing},
		{"oversized dimensions", asset, 12, 12, 200, oversizedDimensions.Bytes(), true, metadata.ErrLookupCoverMissing},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := testCatalog(t, func(w http.ResponseWriter, r catalogRequest) {
				assert.LessOrEqual(t, tc.input, maxCatalogImageID, "invalid IDs must not reach GraphQL")
				assert.Contains(t, r.Query, "$id: bigint!")
				assert.Contains(t, r.Query, "images(where: {id: {_eq: $id}}")
				assert.Equal(t, float64(tc.input), r.Variables["id"])
				fmt.Fprintf(w, `{"data":{"images":[{"id":%d,"url":%q}]}}`, tc.rowID, tc.url)
			})
			var requests int
			c.assets.Transport = coverTransport(func(r *http.Request) (*http.Response, error) {
				requests++
				assert.Equal(t, asset, r.URL.String())
				assert.Equal(t, http.MethodGet, r.Method)
				assert.Empty(t, r.Header.Get("Authorization"))
				assert.Empty(t, r.Header.Get("Cookie"))
				assert.Equal(t, hardcoverUserAgent, r.UserAgent())
				h := make(http.Header)
				h.Set("Location", "https://external.example/cover")
				return &http.Response{StatusCode: tc.status, Header: h, Body: io.NopCloser(bytes.NewReader(tc.body)), ContentLength: -1}, nil
			})
			raw, err := c.Cover(t.Context(), tc.input)
			if tc.assetRequested {
				require.Equal(t, 1, requests)
			} else {
				require.Zero(t, requests)
			}
			require.ErrorIs(t, err, tc.wantErr)
			if err != nil {
				require.Nil(t, raw)
				require.NotContains(t, err.Error(), tc.url)
			} else {
				img, err := jpeg.Decode(bytes.NewReader(raw))
				require.NoError(t, err)
				require.Equal(t, 2, img.Bounds().Dx())
				require.LessOrEqual(t, len(raw), maxCoverJPEG)
			}
		})
	}
}

func TestCatalogCoverAssetDeadline(t *testing.T) {
	c := testCatalog(t, func(w http.ResponseWriter, _ catalogRequest) {
		fmt.Fprint(w, `{"data":{"images":[{"id":12,"url":"https://assets.hardcover.app/edition/77/cover"}]}}`)
	})
	c.assets.Timeout = 20 * time.Millisecond
	c.assets.Transport = coverTransport(func(r *http.Request) (*http.Response, error) {
		select {
		case <-r.Context().Done():
			return nil, r.Context().Err()
		case <-time.After(time.Second):
			t.Error("asset request was not canceled at its deadline")
			return nil, ErrProvider
		}
	})
	raw, err := c.Cover(t.Context(), 12)
	require.ErrorIs(t, err, ErrProvider)
	require.Nil(t, raw)
}

func TestCoverJPEGResizesToFit(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 2048, 2048))
	rng := rand.New(rand.NewPCG(42, 543))
	for y := range img.Bounds().Dy() {
		for x := range img.Bounds().Dx() {
			value := rng.Uint32()
			img.SetRGBA(x, y, color.RGBA{R: uint8(value), G: uint8(value >> 8), B: uint8(value >> 16), A: 255})
		}
	}
	var input bytes.Buffer
	require.NoError(t, jpeg.Encode(&input, img, &jpeg.Options{Quality: 100}))
	require.Greater(t, input.Len(), maxCoverJPEG)
	encoded, err := coverJPEG(input.Bytes())
	require.NoError(t, err)
	require.LessOrEqual(t, len(encoded), maxCoverJPEG)
	decoded, err := jpeg.Decode(bytes.NewReader(encoded))
	require.NoError(t, err)
	require.Less(t, decoded.Bounds().Dx(), img.Bounds().Dx())
	require.Equal(t, decoded.Bounds().Dx(), decoded.Bounds().Dy())
}
