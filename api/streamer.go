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

func (api *API) newStreamer(c *gin.Context) *streamer {
	stream := &streamer{
		templates:  api.Templates,
		writer:     c.Writer,
		completeCh: make(chan struct{}),
	}

	// Set Headers
	header := stream.writer.Header()
	header.Set("Transfer-Encoding", "chunked")
	header.Set("Content-Type", "text/html; charset=utf-8")
	header.Set("X-Content-Type-Options", "nosniff")
	stream.writer.WriteHeader(http.StatusOK)

	// Send Open Element Tags
	stream.write(`
	  <div class="absolute top-0 left-0 w-full h-full z-50">
	    <div class="fixed top-0 left-0 bg-black opacity-50 w-screen h-screen"></div>
	    <div id="stream-main" class="relative max-h-[95%] -translate-x-2/4 top-1/2 left-1/2 w-5/6">`)

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

func (stream *streamer) close() {
	// Send Close Element Tags
	stream.write(`</div></div>`)

	// Close
	close(stream.completeCh)
}
