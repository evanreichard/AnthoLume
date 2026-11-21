package api

import "net/http"

func setCoverResponseHeaders(w http.ResponseWriter) {
	// Untrusted Covers - Every alias serves the same attacker-influenceable bytes, including top-level SVG documents.
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
}

func setRetryAfter(w http.ResponseWriter, status int) {
	if status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable {
		w.Header().Set("Retry-After", "60")
	}
}
