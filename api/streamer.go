package api

import (
	"bytes"
	"html/template"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type streamer struct {
	templates  map[string]*template.Template
	writer     gin.ResponseWriter
	mutex      sync.Mutex
	completeCh chan struct{}
}

func (api *API) newStreamer(c *gin.Context, data string) *streamer {
	stream := &streamer{
		writer:     c.Writer,
		templates:  api.templates,
		completeCh: make(chan struct{}),
	}

	// Set Headers
	header := stream.writer.Header()
	header.Set("Transfer-Encoding", "chunked")
	header.Set("Content-Type", "text/html; charset=utf-8")
	header.Set("X-Content-Type-Options", "nosniff")
	stream.writer.WriteHeader(http.StatusOK)

	// Send Open Element Tags
	stream.write(data)

	// Keep Alive
	go func() {
		closeCh := stream.writer.CloseNotify()
		for {
			select {
			case <-stream.completeCh:
				return
			case <-closeCh:
				return
			default:
				stream.write("<!-- ping -->")
				time.Sleep(2 * time.Second)
			}
		}
	}()

	return stream
}

func (stream *streamer) write(str string) {
	stream.mutex.Lock()
	stream.writer.WriteString(str)
	stream.writer.(http.Flusher).Flush()
	stream.mutex.Unlock()
}

func (stream *streamer) send(templateName string, templateVars gin.H) {
	t := stream.templates[templateName]
	buf := &bytes.Buffer{}
	_ = t.ExecuteTemplate(buf, templateName, templateVars)
	stream.write(buf.String())
}

func (stream *streamer) close(data string) {
	// Send Close Element Tags
	stream.write(data)

	// Close
	close(stream.completeCh)
}
