package api

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

const (
	koSingleBodyLimit    = 16 << 10
	koActivityBodyLimit  = 16 << 20
	koMetadataBodyLimit  = 8 << 20
	koInventoryBodyLimit = 1 << 20
)

func bindKOJSON(c *gin.Context, dst any, limit int64) error {
	if c.Request.ContentLength > limit {
		return &http.MaxBytesError{Limit: limit}
	}
	// Whole Body Limit - Gin decodes only the first JSON value; count trailing bytes before the handler can commit a write.
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, limit))
	if err != nil {
		return err
	}
	return binding.JSON.BindBody(body, dst)
}

func bindKOSyncRequest(c *gin.Context, dst any) bool {
	if err := bindKOJSON(c, dst, koSingleBodyLimit); err != nil {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			c.Abort()
			koJSON(c, http.StatusRequestEntityTooLarge, gin.H{"code": 2000, "message": "Request body too large"})
		} else {
			koSyncError(c, 2003)
		}
		return false
	}
	return true
}

func bindSyncNinjaRequest(c *gin.Context, dst any, limit int64, invalidMessage string) bool {
	if err := bindKOJSON(c, dst, limit); err != nil {
		var max *http.MaxBytesError
		if errors.As(err, &max) {
			apiErrorPage(c, http.StatusRequestEntityTooLarge, "Request body too large")
		} else {
			apiErrorPage(c, http.StatusBadRequest, invalidMessage)
		}
		return false
	}
	return true
}
