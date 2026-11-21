package api

import (
	"errors"
	"io"
	"net/http"
	"os"
	"time"
)

const (
	requestBodyIdleTimeout = 30 * time.Second
	requestBodyTimeout     = 5 * time.Minute
	restoreBodyTimeout     = 30 * time.Minute
)

func boundRequestBody(next http.Handler, idle time.Duration) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Body != nil && req.Body != http.NoBody {
			limit := requestBodyTimeout
			if isRestoreUpload(req) {
				limit = restoreBodyTimeout
			}
			req.Body = &deadlineBody{
				ReadCloser: req.Body,
				controller: http.NewResponseController(w),
				idle:       idle,
				end:        time.Now().Add(limit),
			}
		}
		next.ServeHTTP(w, req)
	})
}

type deadlineBody struct {
	io.ReadCloser
	controller *http.ResponseController
	idle       time.Duration
	end        time.Time
}

func (b *deadlineBody) Read(p []byte) (int, error) {
	now := time.Now()
	deadline := now.Add(b.idle)
	if b.end.Before(deadline) {
		deadline = b.end
	}
	if !now.Before(deadline) {
		return 0, os.ErrDeadlineExceeded
	}
	if err := b.controller.SetReadDeadline(deadline); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return 0, err
	}
	return b.ReadCloser.Read(p)
}

func requestReadTimedOut(err error) bool {
	var timeout interface{ Timeout() bool }
	return errors.As(err, &timeout) && timeout.Timeout()
}
