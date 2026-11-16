package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	contract "antholume.local/api-contract"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
)

type fault struct {
	Mode string `json:"mode"`
	Kind string `json:"kind"`
}
type requestEvidence struct {
	Path   string `json:"path"`
	Method string `json:"method"`
	Origin string `json:"origin"`
	Cookie bool   `json:"cookie"`
	CSRF   bool   `json:"csrf"`
	Status int    `json:"status"`
}
type fixture struct {
	mu                sync.Mutex
	store             *contract.Store
	router            *gin.Engine
	cookies           sessions.Store
	controls          *gin.Engine
	origin, key, path string
	epub              []byte
	next              fault
	requests          []requestEvidence
	opens             int
}

func secret() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func (f *fixture) reopen() error {
	if f.store != nil {
		if err := f.store.DB.Close(); err != nil {
			return err
		}
	}
	store, err := contract.OpenStore(f.path, false)
	if err != nil {
		return err
	}
	f.store = store
	f.opens++
	f.router, err = contract.NewRouterWithOrigin(f.store, f.cookies, f.epub, f.origin)
	return err
}
func (f *fixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/__fixture/") {
		f.controls.ServeHTTP(w, r)
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		http.NotFound(w, r)
		return
	}
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, r)
	f.requests = append(f.requests, requestEvidence{Path: r.URL.Path, Method: r.Method, Origin: r.Header.Get("Origin"), Cookie: r.Header.Get("Cookie") != "", CSRF: r.Header.Get("X-CSRF-Token") != "", Status: rec.Code})
	target := "/api/v1/me/reading-progress"
	if f.next.Kind == "activity" {
		target = "/api/v1/me/activity"
	}
	mode := ""
	if f.next.Mode != "" && r.Method == "POST" && r.URL.Path == target && rec.Code == 200 {
		mode = f.next.Mode
		if mode != "lose" {
			f.next = fault{}
		}
	}
	// Fault Boundary - Only this disposable harness drops/corrupts responses after commit. Drops stay armed until reopen because Chromium may retry a closed connection.
	if mode == "lose" {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			conn.Close()
		}
		return
	}
	body := rec.Body.Bytes()
	if mode != "" {
		var receipt map[string]any
		if err := json.Unmarshal(body, &receipt); err != nil {
			http.Error(w, "fixture serialization", 500)
			return
		}
		switch mode {
		case "wrong-kind":
			if receipt["kind"] == "activity" {
				receipt["kind"] = "progress"
			} else {
				receipt["kind"] = "activity"
			}
		case "wrong-revision":
			receipt["revision"] = "999"
		case "wrong-id":
			receipt["event_id"] = "not-in-flight"
		case "extra-field":
			receipt["unexpected"] = true
		}
		body, _ = json.Marshal(receipt)
	}
	for k, values := range rec.Header() {
		if k != "Content-Length" {
			w.Header()[k] = values
		}
	}
	w.WriteHeader(rec.Code)
	_, _ = w.Write(body)
}
func (f *fixture) controlRoutes() {
	r := gin.New()
	r.Use(sessions.Sessions("proof_session", f.cookies))
	r.GET("/__fixture/health", func(c *gin.Context) { c.JSON(200, gin.H{"ready": true}) })
	r.Use(func(c *gin.Context) {
		if c.GetHeader("X-Fixture-Key") != f.key {
			c.AbortWithStatus(403)
			return
		}
		if c.Request.Method != "GET" && c.GetHeader("Origin") != f.origin {
			c.AbortWithStatus(403)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, contract.JSONLimit)
		c.Next()
	})
	r.POST("/__fixture/session", func(c *gin.Context) {
		token := secret()
		s := sessions.Default(c)
		s.Set("user", "alice")
		s.Set("csrf", token)
		if err := s.Save(); err != nil {
			c.Status(500)
			return
		}
		c.JSON(200, gin.H{"account": "alice", "csrf": token, "origin": f.origin})
	})
	r.POST("/__fixture/expire", func(c *gin.Context) {
		s := sessions.Default(c)
		s.Clear()
		s.Options(sessions.Options{Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
		if err := s.Save(); err != nil {
			c.Status(500)
			return
		}
		c.JSON(200, gin.H{"expired": true})
	})
	r.POST("/__fixture/reset", func(c *gin.Context) {
		f.mu.Lock()
		defer f.mu.Unlock()
		_, err := f.store.DB.Exec("DELETE FROM proof_receipts; DELETE FROM proof_heads; DELETE FROM activity; DELETE FROM document_progress;")
		if err != nil {
			c.Status(500)
			return
		}
		f.next = fault{}
		f.requests = nil
		c.JSON(200, gin.H{"reset": true})
	})
	r.POST("/__fixture/reopen", func(c *gin.Context) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if err := f.reopen(); err != nil {
			c.Status(500)
			return
		}
		f.next = fault{}
		c.JSON(200, gin.H{"opens": f.opens})
	})
	r.POST("/__fixture/fault", func(c *gin.Context) {
		var value fault
		if err := c.ShouldBindJSON(&value); err != nil {
			c.Status(400)
			return
		}
		switch value.Mode {
		case "lose", "wrong-kind", "wrong-revision", "wrong-id", "extra-field":
		default:
			c.Status(400)
			return
		}
		if value.Kind != "progress" && value.Kind != "activity" {
			c.Status(400)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		f.next = value
		c.JSON(200, gin.H{"armed": true})
	})
	r.POST("/__fixture/ko", func(c *gin.Context) {
		var value struct {
			Position string  `json:"position"`
			Fraction float64 `json:"fraction"`
		}
		if err := c.ShouldBindJSON(&value); err != nil {
			c.Status(400)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		if err := f.store.KOWrite(c.Request.Context(), "alice", "book-a", "a-second", value.Position, value.Fraction); err != nil {
			c.Status(500)
			return
		}
		c.JSON(200, gin.H{"accepted": true})
	})
	r.GET("/__fixture/state", func(c *gin.Context) {
		f.mu.Lock()
		defer f.mu.Unlock()
		var head string
		var activities, seconds int
		if err := f.store.DB.QueryRow("SELECT CAST(COALESCE(MAX(revision),0) AS TEXT) FROM proof_heads WHERE user_id='alice' AND document_id='book-a'").Scan(&head); err != nil {
			c.Status(500)
			return
		}
		if err := f.store.DB.QueryRow("SELECT count(*),COALESCE(sum(duration),0) FROM activity WHERE user_id='alice'").Scan(&activities, &seconds); err != nil {
			c.Status(500)
			return
		}
		type receipt struct {
			ID     string          `json:"id"`
			Status int             `json:"status"`
			Body   json.RawMessage `json:"body"`
		}
		receipts := []receipt{}
		rows, err := f.store.DB.Query("SELECT event_id,status,body FROM proof_receipts WHERE user_id='alice' ORDER BY event_id")
		if err != nil {
			c.Status(500)
			return
		}
		for rows.Next() {
			var v receipt
			if err = rows.Scan(&v.ID, &v.Status, &v.Body); err != nil {
				rows.Close()
				c.Status(500)
				return
			}
			receipts = append(receipts, v)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			c.Status(500)
			return
		}
		type progress struct {
			Device   string  `json:"device"`
			Fraction float64 `json:"fraction"`
			Position string  `json:"position"`
		}
		progressRows := []progress{}
		rows, err = f.store.DB.Query("SELECT device_id,percentage,progress FROM document_progress WHERE user_id='alice' AND document_id='book-a' ORDER BY device_id")
		if err != nil {
			c.Status(500)
			return
		}
		for rows.Next() {
			var v progress
			if err = rows.Scan(&v.Device, &v.Fraction, &v.Position); err != nil {
				rows.Close()
				c.Status(500)
				return
			}
			progressRows = append(progressRows, v)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			c.Status(500)
			return
		}
		hash := sha256.Sum256(f.epub)
		c.JSON(200, gin.H{"head": head, "activities": activities, "seconds": seconds, "receipts": receipts, "progress": progressRows, "opens": f.opens, "requests": f.requests, "bytes": len(f.epub), "sha256": hex.EncodeToString(hash[:]), "origin": f.origin})
	})
	f.controls = r
}
func run() error {
	addr := flag.String("addr", "127.0.0.1:0", "test-managed loopback listener")
	assets := flag.String("assets", "", "compiled integration assets")
	epubPath := flag.String("epub", "../reader-storage/public/fixtures/synthetic.epub", "public synthetic EPUB")
	data := flag.String("data", "", "assigned scratch parent for temporary SQLite")
	flag.Parse()
	gin.SetMode(gin.TestMode)
	host, _, err := net.SplitHostPort(*addr)
	if err != nil || host != "127.0.0.1" {
		return errors.New("loopback 127.0.0.1 listener required")
	}
	if *assets == "" || *data == "" {
		return errors.New("assets and data paths required")
	}
	if err = os.MkdirAll(*data, 0700); err != nil {
		return err
	}
	work, err := os.MkdirTemp(*data, "server.")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	defer listener.Close()
	epub, err := os.ReadFile(*epubPath)
	if err != nil {
		return err
	}
	f := &fixture{origin: "http://" + listener.Addr().String(), key: secret(), path: filepath.Join(work, "integration.db"), epub: epub, opens: 1, requests: []requestEvidence{}}
	f.cookies = cookie.NewStore([]byte(secret()))
	// Loopback Fixture - Plain HTTP is test-local only; production Secure-cookie/TLS policy is not relaxed by this module.
	f.cookies.Options(sessions.Options{Path: "/", MaxAge: 3600, HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: false})
	f.store, err = contract.OpenStore(f.path, true)
	if err != nil {
		return err
	}
	defer func() { f.store.DB.Close() }()
	f.router, err = contract.NewRouterWithOrigin(f.store, f.cookies, f.epub, f.origin)
	if err != nil {
		return err
	}
	f.controlRoutes()
	files := http.FileServer(http.Dir(*assets))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/__fixture/") {
			f.ServeHTTP(w, r)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			http.NotFound(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, MaxHeaderBytes: 16 * 1024}
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, syscall.SIGTERM, syscall.SIGINT)
	defer signal.Stop(stopped)
	serveErrors := make(chan error, 1)
	go func() { serveErrors <- server.Serve(listener) }()
	// Test Handshake - The random control key is delivered only to the test process, never embedded in public assets.
	if err = json.NewEncoder(os.Stdout).Encode(map[string]string{"origin": f.origin, "key": f.key}); err != nil {
		return err
	}
	select {
	case <-stopped:
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(ctx)
	case err = <-serveErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
