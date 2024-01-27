package api

import (
	"fmt"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"net/http"
	"os"
	"path/filepath"
	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
)

func (api *API) createDownloadDocumentHandler(errorFunc func(*gin.Context, int, string)) func(*gin.Context) {
	return func(c *gin.Context) {
		var rDoc requestDocumentID
		if err := c.ShouldBindUri(&rDoc); err != nil {
			log.Error("Invalid URI Bind")
			errorFunc(c, http.StatusBadRequest, "Invalid Request")
			return
		}

		// Get Document
		document, err := api.DB.Queries.GetDocument(api.DB.Ctx, rDoc.DocumentID)
		if err != nil {
			log.Error("GetDocument DB Error:", err)
			errorFunc(c, http.StatusBadRequest, "Unknown Document")
			return
		}

		if document.Filepath == nil {
			log.Error("Document Doesn't Have File:", rDoc.DocumentID)
			errorFunc(c, http.StatusBadRequest, "Document Doesn't Exist")
			return
		}

		// Derive Storage Location
		filePath := filepath.Join(api.Config.DataPath, "documents", *document.Filepath)

		// Validate File Exists
		_, err = os.Stat(filePath)
		if os.IsNotExist(err) {
			log.Error("File Doesn't Exist:", rDoc.DocumentID)
			errorFunc(c, http.StatusBadRequest, "Document Doesn't Exist")
			return
		}

		// Force Download
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filepath.Base(*document.Filepath)))
		c.File(filePath)
	}
}

func (api *API) createGetCoverHandler(errorFunc func(*gin.Context, int, string)) func(*gin.Context) {
	return func(c *gin.Context) {
		var rDoc requestDocumentID
		if err := c.ShouldBindUri(&rDoc); err != nil {
			log.Error("Invalid URI Bind")
			errorFunc(c, http.StatusNotFound, "Invalid cover.")
			return
		}

		// Validate Document Exists in DB
		document, err := api.DB.Queries.GetDocument(api.DB.Ctx, rDoc.DocumentID)
		if err != nil {
			log.Error("GetDocument DB Error:", err)
			errorFunc(c, http.StatusInternalServerError, fmt.Sprintf("GetDocument DB Error: %v", err))
			return
		}

		// Handle Identified Document
		if document.Coverfile != nil {
			if *document.Coverfile == "UNKNOWN" {
				c.FileFromFS("assets/images/no-cover.jpg", http.FS(api.Assets))
				return
			}

			// Derive Path
			safePath := filepath.Join(api.Config.DataPath, "covers", *document.Coverfile)

			// Validate File Exists
			_, err = os.Stat(safePath)
			if err != nil {
				log.Error("File Should But Doesn't Exist:", err)
				c.FileFromFS("assets/images/no-cover.jpg", http.FS(api.Assets))
				return
			}

			c.File(safePath)
			return
		}

		// Attempt Metadata
		var coverDir string = filepath.Join(api.Config.DataPath, "covers")
		var coverFile string = "UNKNOWN"

		// Identify Documents & Save Covers
		metadataResults, err := metadata.SearchMetadata(metadata.GBOOK, metadata.MetadataInfo{
			Title:  document.Title,
			Author: document.Author,
		})

		if err == nil && len(metadataResults) > 0 && metadataResults[0].ID != nil {
			firstResult := metadataResults[0]

			// Save Cover
			fileName, err := metadata.CacheCover(*firstResult.ID, coverDir, document.ID, false)
			if err == nil {
				coverFile = *fileName
			}

			// Store First Metadata Result
			if _, err = api.DB.Queries.AddMetadata(api.DB.Ctx, database.AddMetadataParams{
				DocumentID:  document.ID,
				Title:       firstResult.Title,
				Author:      firstResult.Author,
				Description: firstResult.Description,
				Gbid:        firstResult.ID,
				Olid:        nil,
				Isbn10:      firstResult.ISBN10,
				Isbn13:      firstResult.ISBN13,
			}); err != nil {
				log.Error("AddMetadata DB Error:", err)
			}
		}

		// Upsert Document
		if _, err = api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
			ID:        document.ID,
			Coverfile: &coverFile,
		}); err != nil {
			log.Warn("UpsertDocument DB Error:", err)
		}

		// Return Unknown Cover
		if coverFile == "UNKNOWN" {
			c.FileFromFS("assets/images/no-cover.jpg", http.FS(api.Assets))
			return
		}

		coverFilePath := filepath.Join(coverDir, coverFile)
		c.File(coverFilePath)
	}
}
