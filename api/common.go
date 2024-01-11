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

func (api *API) downloadDocument(c *gin.Context) {
	var rDoc requestDocumentID
	if err := c.ShouldBindUri(&rDoc); err != nil {
		log.Error("[downloadDocument] Invalid URI Bind")
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid Request"})
		return
	}

	// Get Document
	document, err := api.DB.Queries.GetDocument(api.DB.Ctx, rDoc.DocumentID)
	if err != nil {
		log.Error("[downloadDocument] GetDocument DB Error:", err)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Unknown Document"})
		return
	}

	if document.Filepath == nil {
		log.Error("[downloadDocument] Document Doesn't Have File:", rDoc.DocumentID)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Document Doesn't Exist"})
		return
	}

	// Derive Storage Location
	filePath := filepath.Join(api.Config.DataPath, "documents", *document.Filepath)

	// Validate File Exists
	_, err = os.Stat(filePath)
	if os.IsNotExist(err) {
		log.Error("[downloadDocument] File Doesn't Exist:", rDoc.DocumentID)
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Document Doesn't Exists"})
		return
	}

	// Force Download (Security)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filepath.Base(*document.Filepath)))
	c.File(filePath)
}

func (api *API) getDocumentCover(c *gin.Context) {
	var rDoc requestDocumentID
	if err := c.ShouldBindUri(&rDoc); err != nil {
		log.Error("[getDocumentCover] Invalid URI Bind")
		errorPage(c, http.StatusNotFound, "Invalid cover.")
		return
	}

	// Validate Document Exists in DB
	document, err := api.DB.Queries.GetDocument(api.DB.Ctx, rDoc.DocumentID)
	if err != nil {
		log.Error("[getDocumentCover] GetDocument DB Error:", err)
		errorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocument DB Error: %v", err))
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
			log.Error("[getDocumentCover] File Should But Doesn't Exist:", err)
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
			log.Error("[getDocumentCover] AddMetadata DB Error:", err)
		}
	}

	// Upsert Document
	if _, err = api.DB.Queries.UpsertDocument(api.DB.Ctx, database.UpsertDocumentParams{
		ID:        document.ID,
		Coverfile: &coverFile,
	}); err != nil {
		log.Warn("[getDocumentCover] UpsertDocument DB Error:", err)
	}

	// Return Unknown Cover
	if coverFile == "UNKNOWN" {
		c.FileFromFS("assets/images/no-cover.jpg", http.FS(api.Assets))
		return
	}

	coverFilePath := filepath.Join(coverDir, coverFile)
	c.File(coverFilePath)
}
