package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"reichard.io/antholume/reading"
)

func koSyncError(c *gin.Context, code int) {
	status, message := http.StatusBadGateway, "Unknown server error."
	switch code {
	case 2001:
		status, message = http.StatusUnauthorized, "Unauthorized"
	case 2002:
		status, message = http.StatusPaymentRequired, "Username is already registered."
	case 2003:
		status, message = http.StatusForbidden, "Invalid request"
	case 2004:
		status, message = http.StatusForbidden, "Field 'document' not provided."
	case 2005:
		status, message = http.StatusPaymentRequired, "User registration is disabled."
	default:
		code = 2000
	}
	c.Abort()
	koJSON(c, status, gin.H{"code": code, "message": message})
}

func koSyncOverload(c *gin.Context, status int) {
	setRetryAfter(c.Writer, status)
	c.Abort()
	koJSON(c, status, gin.H{"code": 2000, "message": http.StatusText(status)})
}

func koSyncOperationError(c *gin.Context, err error) {
	var f *reading.Failure
	if errors.As(err, &f) {
		switch f.Status {
		case http.StatusTooManyRequests, http.StatusServiceUnavailable:
			koSyncOverload(c, f.Status)
			return
		case http.StatusUnauthorized:
			koSyncError(c, 2001)
			return
		case http.StatusBadRequest, http.StatusForbidden, http.StatusConflict:
			koSyncError(c, 2003)
			return
		}
	}
	koSyncError(c, 2000)
}

func koOperationError(c *gin.Context, err error) {
	var f *reading.Failure
	if errors.As(err, &f) {
		apiErrorPage(c, f.Status, "Invalid Request")
		return
	}
	apiErrorPage(c, 500, "Unable to complete request")
}
