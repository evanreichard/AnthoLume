package api

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
)

func (api *API) createDownloadDocumentHandler(errorFunc func(*gin.Context, int, string)) func(*gin.Context) {
	return func(c *gin.Context) {
		var rDoc requestDocumentID
		if err := c.ShouldBindUri(&rDoc); err != nil {
			log.Error("Invalid URI Bind")
			errorFunc(c, http.StatusBadRequest, "Invalid Request")
			return
		}

		path, f, err := api.openDownload(c.Request.Context(), rDoc.DocumentID, true)
		if err != nil {
			log.Error("Open document: ", err)
			message := "Unknown Document"
			if errors.Is(err, os.ErrNotExist) {
				message = "Document Doesn't Exist"
			}
			errorFunc(c, http.StatusBadRequest, message)
			return
		}

		name := filepath.Base(path)
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", name))
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			errorFunc(c, http.StatusNotFound, "Document Doesn't Exist")
			return
		}
		http.ServeContent(c.Writer, c.Request, name, info.ModTime(), f)
	}
}

func (api *API) createGetCoverHandler(errorFunc func(*gin.Context, int, string)) func(*gin.Context) {
	return func(c *gin.Context) {
		setCoverResponseHeaders(c.Writer)
		var rDoc requestDocumentID
		if err := c.ShouldBindUri(&rDoc); err != nil {
			log.Error("Invalid URI Bind")
			errorFunc(c, http.StatusNotFound, "Invalid cover.")
			return
		}

		// Validate Document Exists in DB
		document, err := api.db.Queries.GetDocument(c, rDoc.DocumentID)
		if err != nil {
			log.Error("GetDocument DB Error:", err)
			errorFunc(c, http.StatusInternalServerError, fmt.Sprintf("GetDocument DB Error: %v", err))
			return
		}

		// Handle Identified Document
		if document.Coverfile != nil {
			if *document.Coverfile == "UNKNOWN" {
				c.FileFromFS("assets/images/no-cover.jpg", http.FS(api.assets))
				return
			}

			// Derive Path
			safePath := filepath.Join(api.cfg.DataPath, "covers", *document.Coverfile)

			// Validate File Exists
			_, err = os.Stat(safePath)
			if err != nil {
				log.Error("File should but doesn't exist: ", err)
				c.FileFromFS("assets/images/no-cover.jpg", http.FS(api.assets))
				return
			}

			c.File(safePath)
			return
		}

		c.FileFromFS("assets/images/no-cover.jpg", http.FS(api.assets))
	}
}
