// Test-only composition of the production router. No fixture routes are installed.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"reichard.io/antholume/api"
	"reichard.io/antholume/config"
	"reichard.io/antholume/database"
)

func authProblem(valid bool) []byte {
	if !valid {
		return []byte(`{"status":401,"code":"unauthenticated"}`)
	}
	body, _ := json.Marshal(map[string]any{"type": "urn:antholume:problem:unauthenticated", "title": "Unauthorized", "status": 401, "code": "unauthenticated", "detail": "Authentication required."})
	return body
}

type slowOriginalWriter struct {
	http.ResponseWriter
	ctx context.Context
}

func (w *slowOriginalWriter) Write(bytes []byte) (int, error) {
	written := 0
	for len(bytes) > 0 {
		timer := time.NewTimer(20 * time.Millisecond)
		select {
		case <-w.ctx.Done():
			timer.Stop()
			return written, w.ctx.Err()
		case <-timer.C:
		}
		size := len(bytes)
		if size > 65536 {
			size = 65536
		}
		n, err := w.ResponseWriter.Write(bytes[:size])
		written += n
		if flush, ok := w.ResponseWriter.(http.Flusher); ok {
			flush.Flush()
		}
		if err != nil {
			return written, err
		}
		if n == 0 {
			return written, io.ErrShortWrite
		}
		bytes = bytes[n:]
	}
	return written, nil
}

func main() {
	root := flag.String("root", "", "checkout containing compiled assets and templates")
	data := flag.String("data", "", "isolated synthetic data directory")
	addr := flag.String("addr", "127.0.0.1:5323", "owned loopback address")
	public := flag.String("public-origin", "", "browser origin for the development proxy test")
	flag.Parse()
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		panic(err)
	}
	host, _, _ := net.SplitHostPort(listener.Addr().String())
	if host != "127.0.0.1" {
		panic("test server must bind loopback")
	}
	origin := "http://" + listener.Addr().String()
	publicOrigin := origin
	if *public != "" {
		publicOrigin = *public
	}
	c := &config.Config{Version: "m3-browser-test", ConfigPath: *data, DataPath: *data, DBType: "sqlite", DBName: "browser", PublicOrigin: publicOrigin, RegistrationEnabled: true, CookieAuthKey: "synthetic-browser-test-cookie-auth-key-not-for-production-123456789"}
	c.EnsureDirectories()
	db := database.NewMgr(c)
	defer db.DB.Close()
	tx, err := db.DB.Begin()
	if err != nil {
		panic(err)
	}
	for i := 1; i <= 30; i++ {
		_, err = tx.Exec("INSERT OR IGNORE INTO documents (id,title,author,filepath,coverfile,description,words,created_at) VALUES(?,?,?,?,?,?,?,'2020-01-01T00:00:00Z')", fmt.Sprintf("book_%03d", i), fmt.Sprintf("Public book %02d", i), "Synthetic Author", "public.epub", "public.png", "<script>window.__untrusted = true</script>\nSynthetic public text; rendered inertly.", 10000)
		if err != nil {
			panic(err)
		}
	}
	if err = tx.Commit(); err != nil {
		panic(err)
	}
	if _, err = os.Stat(filepath.Join(*data, "documents", "public.epub")); err != nil {
		panic(err)
	}
	app, err := api.NewAPI(db, c, os.DirFS(*root))
	if err != nil {
		panic(err)
	}
	workerCtx, stopWorker := context.WithCancel(context.Background())
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		app.RunAutoImports(workerCtx)
	}()
	defer func() {
		stopWorker()
		<-workerDone
	}()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/sw.js" {
			if source, err := os.ReadFile(filepath.Join(*data, "legacy-worker")); err == nil {
				w.Header().Set("Cache-Control", "no-cache")
				w.Header().Set("Content-Type", "application/javascript")
				w.Write(source)
				return
			}
		}
		if r.URL.Path == "/api/v1/documents/book_002/file" {
			if _, err := os.Stat(filepath.Join(*data, "slow-download")); err == nil {
				app.Handler().ServeHTTP(&slowOriginalWriter{ResponseWriter: w, ctx: r.Context()}, r)
				return
			}
		}
		if r.URL.Path == "/api/v1/session" {
			if _, err := os.Stat(filepath.Join(*data, "session-unavailable")); err == nil {
				recorded := httptest.NewRecorder()
				app.Handler().ServeHTTP(recorded, r)
				w.Header().Set("Cache-Control", "private, no-store")
				w.Header().Set("Content-Type", "application/problem+json")
				w.Header().Set("Retry-After", "1")
				w.WriteHeader(503)
				json.NewEncoder(w).Encode(map[string]any{"type": "urn:antholume:test:session-unavailable", "title": "Service Unavailable", "status": 503, "code": "storage_error", "detail": "Session temporarily unavailable. " + strings.Repeat("Saved local books remain usable. ", 80)})
				return
			}
		}
		if strings.HasPrefix(r.URL.Path, "/api/v1/me/reading-state/") {
			if mode, err := os.ReadFile(filepath.Join(*data, "state-fault")); err == nil {
				recorded := httptest.NewRecorder()
				app.Handler().ServeHTTP(recorded, r)
				for key, values := range recorded.Header() {
					for _, value := range values {
						w.Header().Add(key, value)
					}
				}
				w.Header().Del("Content-Length")
				if recorded.Code != 200 {
					w.WriteHeader(recorded.Code)
					w.Write(recorded.Body.Bytes())
					return
				}
				if strings.TrimSpace(string(mode)) == "malformed-200" {
					var state map[string]any
					if json.Unmarshal(recorded.Body.Bytes(), &state) != nil {
						panic("invalid production state")
					}
					delete(state, "revision")
					w.WriteHeader(200)
					json.NewEncoder(w).Encode(state)
				} else {
					w.Header().Set("Content-Type", "application/problem+json")
					w.WriteHeader(503)
					json.NewEncoder(w).Encode(map[string]any{"type": "urn:antholume:test:state-unavailable", "title": "Service Unavailable", "status": 503, "code": "storage_error", "detail": "State route temporarily unavailable."})
				}
				return
			}
		}
		readFault, _ := os.ReadFile(filepath.Join(*data, "read-fault"))
		var denied struct {
			Path  string `json:"path"`
			Valid bool   `json:"valid"`
		}
		if json.Unmarshal(readFault, &denied) == nil && r.URL.Path == denied.Path {
			recorded := httptest.NewRecorder()
			app.Handler().ServeHTTP(recorded, r)
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(401)
			w.Write(authProblem(denied.Valid))
			return
		}
		mode, _ := os.ReadFile(filepath.Join(*data, "receipt-fault"))
		event := r.URL.Path == "/api/v1/me/reading-progress" || r.URL.Path == "/api/v1/me/activity"
		if !event || len(mode) == 0 {
			app.Handler().ServeHTTP(w, r)
			return
		}
		recorded := httptest.NewRecorder()
		app.Handler().ServeHTTP(recorded, r)
		for key, values := range recorded.Header() {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		status := recorded.Code
		body := recorded.Body.Bytes()
		fault := strings.TrimSpace(string(mode))
		if status == 200 && fault == "held-valid-401" {
			held, err := os.OpenFile(filepath.Join(*data, "event-held"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if err != nil {
				fault = ""
			} else {
				held.Write(body)
				held.Close()
				deadline := time.NewTimer(15 * time.Second)
				ticker := time.NewTicker(10 * time.Millisecond)
				defer deadline.Stop()
				defer ticker.Stop()
			wait:
				for {
					select {
					case <-r.Context().Done():
						return
					case <-deadline.C:
						break wait
					case <-ticker.C:
						if _, err := os.Stat(filepath.Join(*data, "release-event")); err == nil {
							break wait
						}
					}
				}
			}
		}
		if status == 200 && fault != "" {
			w.Header().Del("Content-Length")
			if fault == "malformed-401" || fault == "valid-401" || fault == "held-valid-401" {
				status = 401
				w.Header().Set("Content-Type", "application/problem+json")
				body = authProblem(fault != "malformed-401")
			} else if fault == "server-error" {
				status = 500
				w.Header().Set("Content-Type", "application/problem+json")
			} else {
				var receipt map[string]any
				if json.Unmarshal(body, &receipt) != nil {
					panic("invalid production receipt")
				}
				receipt["untrusted_extra"] = true
				body, _ = json.Marshal(receipt)
			}
		}
		w.WriteHeader(status)
		w.Write(body)
	})
	// Browser Preconnects - Idle speculative connections must finish before the fixture's five-second graceful shutdown deadline.
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 2 * time.Second}
	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)
	failure := make(chan error, 1)
	go func() { failure <- server.Serve(listener) }()
	json.NewEncoder(os.Stdout).Encode(map[string]string{"origin": origin})
	select {
	case <-done:
	case err = <-failure:
		if err != http.ErrServerClosed {
			panic(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err = server.Shutdown(ctx); err != nil {
		panic(err)
	}
	if err = app.Shutdown(ctx); err != nil {
		panic(err)
	}
}
