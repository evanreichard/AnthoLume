package api

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gabriel-vasile/mimetype"
	"github.com/gin-gonic/gin"
	log "github.com/sirupsen/logrus"
	"golang.org/x/exp/slices"
	"reichard.io/antholume/database"
	"reichard.io/antholume/metadata"
	"reichard.io/antholume/search"
)

type backupType string

const (
	backupCovers    backupType = "COVERS"
	backupDocuments backupType = "DOCUMENTS"
)

type queryParams struct {
	Page     *int64  `form:"page"`
	Limit    *int64  `form:"limit"`
	Search   *string `form:"search"`
	Document *string `form:"document"`
}

type searchParams struct {
	Query  *string        `form:"query"`
	Source *search.Source `form:"source"`
}

type requestDocumentUpload struct {
	DocumentFile *multipart.FileHeader `form:"document_file"`
}

type requestDocumentEdit struct {
	Title       *string               `form:"title"`
	Author      *string               `form:"author"`
	Description *string               `form:"description"`
	ISBN10      *string               `form:"isbn_10"`
	ISBN13      *string               `form:"isbn_13"`
	RemoveCover *string               `form:"remove_cover"`
	CoverGBID   *string               `form:"cover_gbid"`
	CoverFile   *multipart.FileHeader `form:"cover_file"`
}

type requestDocumentIdentify struct {
	Title  *string `form:"title"`
	Author *string `form:"author"`
	ISBN   *string `form:"isbn"`
}

type requestSettingsEdit struct {
	Password    *string `form:"password"`
	NewPassword *string `form:"new_password"`
	Timezone    *string `form:"timezone"`
}

type requestDocumentAdd struct {
	ID     string        `form:"id"`
	Title  *string       `form:"title"`
	Author *string       `form:"author"`
	Source search.Source `form:"source"`
}

func (api *API) appWebManifest(c *gin.Context) {
	c.Header("Content-Type", "application/manifest+json")
	c.FileFromFS("assets/manifest.json", http.FS(api.assets))
}

func (api *API) appServiceWorker(c *gin.Context) {
	c.FileFromFS("assets/sw.js", http.FS(api.assets))
}

func (api *API) appFaviconIcon(c *gin.Context) {
	c.FileFromFS("assets/icons/favicon.ico", http.FS(api.assets))
}

func (api *API) appLocalDocuments(c *gin.Context) {
	c.FileFromFS("assets/local/index.htm", http.FS(api.assets))
}

func (api *API) appDocumentReader(c *gin.Context) {
	c.FileFromFS("assets/reader/index.htm", http.FS(api.assets))
}

func (api *API) appGetLogin(c *gin.Context) {
	templateVars, _ := api.getBaseTemplateVars("login", c)
	templateVars["RegistrationEnabled"] = api.cfg.RegistrationEnabled
	c.HTML(http.StatusOK, "page/login", templateVars)
}

func (api *API) appGetRegister(c *gin.Context) {
	if !api.cfg.RegistrationEnabled {
		c.Redirect(http.StatusFound, "/login")
		return
	}

	templateVars, _ := api.getBaseTemplateVars("login", c)
	templateVars["RegistrationEnabled"] = api.cfg.RegistrationEnabled
	templateVars["Register"] = true
	c.HTML(http.StatusOK, "page/login", templateVars)
}

func (api *API) appGetDocumentProgress(c *gin.Context) {
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	var rDoc requestDocumentID
	if err := c.ShouldBindUri(&rDoc); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid document")
		return
	}

	progress, err := api.db.Queries.GetDocumentProgress(c, database.GetDocumentProgressParams{
		DocumentID: rDoc.DocumentID,
		UserID:     auth.UserName,
	})
	if err != nil && err != sql.ErrNoRows {
		log.Error("GetDocumentProgress DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocumentProgress DB Error: %v", err))
		return
	}

	document, err := api.db.GetDocument(c, rDoc.DocumentID, auth.UserName)
	if err != nil {
		log.Error("GetDocument DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDocument DB Error: %v", err))
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":         document.ID,
		"title":      document.Title,
		"author":     document.Author,
		"words":      document.Words,
		"progress":   progress.Progress,
		"percentage": document.Percentage,
	})
}

func (api *API) appGetDevices(c *gin.Context) {
	var auth authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(authData)
	}

	devices, err := api.db.Queries.GetDevices(c, auth.UserName)

	if err != nil && err != sql.ErrNoRows {
		log.Error("GetDevices DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("GetDevices DB Error: %v", err))
		return
	}

	c.JSON(http.StatusOK, devices)
}

func (api *API) appUploadNewDocument(c *gin.Context) {
	var rDocUpload requestDocumentUpload
	if err := c.ShouldBind(&rDocUpload); err != nil {
		log.Error("Invalid Form Bind")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values")
		return
	}

	if rDocUpload.DocumentFile == nil {
		c.Redirect(http.StatusFound, "./documents")
		return
	}

	// Create Temp File
	tempFile, err := os.CreateTemp("", "book")
	if err != nil {
		log.Warn("Temp File Create Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to create temp file")
		return
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	// Save Temp File
	err = c.SaveUploadedFile(rDocUpload.DocumentFile, tempFile.Name())
	if err != nil {
		log.Error("File Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to save file")
		return
	}

	// Get Metadata
	metadataInfo, err := metadata.GetMetadata(tempFile.Name())
	if err != nil {
		log.Errorf("unable to acquire metadata: %v", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to acquire metadata")
		return
	}

	// Check Already Exists
	_, err = api.db.Queries.GetDocument(c, *metadataInfo.PartialMD5)
	if err == nil {
		log.Warnf("document already exists: %s", *metadataInfo.PartialMD5)
		c.Redirect(http.StatusFound, fmt.Sprintf("./documents/%s", *metadataInfo.PartialMD5))
	}

	// Derive & Sanitize File Name
	fileName := deriveBaseFileName(metadataInfo)
	basePath := filepath.Join(api.cfg.DataPath, "documents")
	safePath := filepath.Join(basePath, fileName)

	// Open Destination File
	destFile, err := os.Create(safePath)
	if err != nil {
		log.Errorf("unable to open destination file: %v", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to open destination file")
		return
	}
	defer destFile.Close()

	// Copy File
	if _, err = io.Copy(destFile, tempFile); err != nil {
		log.Errorf("unable to save file: %v", err)
		appErrorPage(c, http.StatusInternalServerError, "Unable to save file")
		return
	}

	// Upsert Document
	if _, err = api.db.Queries.UpsertDocument(c, database.UpsertDocumentParams{
		ID:          *metadataInfo.PartialMD5,
		Title:       metadataInfo.Title,
		Author:      metadataInfo.Author,
		Description: metadataInfo.Description,
		Md5:         metadataInfo.MD5,
		Words:       metadataInfo.WordCount,
		Filepath:    &fileName,
		Basepath:    &basePath,
	}); err != nil {
		log.Errorf("UpsertDocument DB Error: %v", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpsertDocument DB Error: %v", err))
		return
	}

	c.Redirect(http.StatusFound, fmt.Sprintf("./documents/%s", *metadataInfo.PartialMD5))
}

func (api *API) appEditDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid document")
		return
	}

	var rDocEdit requestDocumentEdit
	if err := c.ShouldBind(&rDocEdit); err != nil {
		log.Error("Invalid Form Bind")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values")
		return
	}

	// Validate Something Exists
	if rDocEdit.Author == nil &&
		rDocEdit.Title == nil &&
		rDocEdit.Description == nil &&
		rDocEdit.ISBN10 == nil &&
		rDocEdit.ISBN13 == nil &&
		rDocEdit.RemoveCover == nil &&
		rDocEdit.CoverGBID == nil &&
		rDocEdit.CoverFile == nil {
		log.Error("Missing Form Values")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values")
		return
	}

	// Handle Cover
	var coverFileName *string
	if rDocEdit.RemoveCover != nil && *rDocEdit.RemoveCover == "on" {
		s := "UNKNOWN"
		coverFileName = &s
	} else if rDocEdit.CoverFile != nil {
		// Validate Type & Derive Extension on MIME
		uploadedFile, err := rDocEdit.CoverFile.Open()
		if err != nil {
			log.Error("File Error")
			appErrorPage(c, http.StatusInternalServerError, "Unable to open file")
			return
		}

		fileMime, err := mimetype.DetectReader(uploadedFile)
		if err != nil {
			log.Error("MIME Error")
			appErrorPage(c, http.StatusInternalServerError, "Unable to detect filetype")
			return
		}
		fileExtension := fileMime.Extension()

		// Validate Extension
		if !slices.Contains([]string{".jpg", ".png"}, fileExtension) {
			log.Error("Invalid FileType: ", fileExtension)
			appErrorPage(c, http.StatusBadRequest, "Invalid filetype")
			return
		}

		// Generate Storage Path
		fileName := fmt.Sprintf("%s%s", rDocID.DocumentID, fileExtension)
		safePath := filepath.Join(api.cfg.DataPath, "covers", fileName)

		// Save
		err = c.SaveUploadedFile(rDocEdit.CoverFile, safePath)
		if err != nil {
			log.Error("File Error: ", err)
			appErrorPage(c, http.StatusInternalServerError, "Unable to save file")
			return
		}

		coverFileName = &fileName
	} else if rDocEdit.CoverGBID != nil {
		coverDir := filepath.Join(api.cfg.DataPath, "covers")
		fileName, err := metadata.CacheCover(*rDocEdit.CoverGBID, coverDir, rDocID.DocumentID, true)
		if err == nil {
			coverFileName = fileName
		}
	}

	// Update Document
	if _, err := api.db.Queries.UpsertDocument(c, database.UpsertDocumentParams{
		ID:          rDocID.DocumentID,
		Title:       api.sanitizeInput(rDocEdit.Title),
		Author:      api.sanitizeInput(rDocEdit.Author),
		Description: api.sanitizeInput(rDocEdit.Description),
		Isbn10:      api.sanitizeInput(rDocEdit.ISBN10),
		Isbn13:      api.sanitizeInput(rDocEdit.ISBN13),
		Coverfile:   coverFileName,
	}); err != nil {
		log.Error("UpsertDocument DB Error: ", err)
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("UpsertDocument DB Error: %v", err))
		return
	}

	c.Redirect(http.StatusFound, "./")
}

func (api *API) appDeleteDocument(c *gin.Context) {
	var rDocID requestDocumentID
	if err := c.ShouldBindUri(&rDocID); err != nil {
		log.Error("Invalid URI Bind")
		appErrorPage(c, http.StatusNotFound, "Invalid document")
		return
	}
	changed, err := api.db.Queries.DeleteDocument(c, rDocID.DocumentID)
	if err != nil {
		log.Error("DeleteDocument DB Error")
		appErrorPage(c, http.StatusInternalServerError, fmt.Sprintf("DeleteDocument DB Error: %v", err))
		return
	}
	if changed == 0 {
		log.Error("DeleteDocument DB Error")
		appErrorPage(c, http.StatusNotFound, "Invalid document")
		return
	}

	c.Redirect(http.StatusFound, "../")
}

func (api *API) appSaveNewDocument(c *gin.Context) {
	var rDocAdd requestDocumentAdd
	if err := c.ShouldBind(&rDocAdd); err != nil {
		log.Error("Invalid Form Bind")
		appErrorPage(c, http.StatusBadRequest, "Invalid or missing form values")
		return
	}

	// Render Initial Template
	templateVars, _ := api.getBaseTemplateVars("search", c)
	c.HTML(http.StatusOK, "page/search", templateVars)

	// Create Streamer
	stream := api.newStreamer(c, `
	  <div class="absolute top-0 left-0 w-full h-full z-50">
	    <div class="fixed top-0 left-0 bg-black opacity-50 w-screen h-screen"></div>
	    <div id="stream-main" class="relative max-h-[95%] -translate-x-2/4 top-1/2 left-1/2 w-5/6">`)
	defer stream.close(`</div></div>`)

	// Stream Helper Function
	sendDownloadMessage := func(msg string, args ...map[string]any) {
		// Merge Defaults & Overrides
		var templateVars = gin.H{
			"Message":    msg,
			"ButtonText": "Close",
			"ButtonHref": "./search",
		}
		if len(args) > 0 {
			for key := range args[0] {
				templateVars[key] = args[0][key]
			}
		}

		stream.send("component/download-progress", templateVars)
	}

	// Send Message
	sendDownloadMessage("Downloading document...", gin.H{"Progress": 1})

	// Scaled Download Function
	lastTime := time.Now()
	downloadFunc := func(p float32) {
		nowTime := time.Now()
		if nowTime.Before(lastTime.Add(time.Millisecond * 500)) {
			return
		}
		scaledProgress := int((p * 95 / 100) + 2)
		sendDownloadMessage("Downloading document...", gin.H{"Progress": scaledProgress})
		lastTime = nowTime
	}

	// Save Book
	tempFilePath, metadata, err := search.SaveBook(rDocAdd.ID, rDocAdd.Source, downloadFunc)
	if err != nil {
		log.Warn("Save Book Error: ", err)
		sendDownloadMessage("Unable to download file", gin.H{"Error": true})
		return
	}

	// Send Message
	sendDownloadMessage("Saving document...", gin.H{"Progress": 98})

	// Derive Author / Title
	docAuthor := "Unknown"
	if *metadata.Author != "" {
		docAuthor = *metadata.Author
	} else if *rDocAdd.Author != "" {
		docAuthor = *rDocAdd.Author
	}

	docTitle := "Unknown"
	if *metadata.Title != "" {
		docTitle = *metadata.Title
	} else if *rDocAdd.Title != "" {
		docTitle = *rDocAdd.Title
	}

	// Remove Slashes & Sanitize File Name
	fileName := fmt.Sprintf("%s - %s", docAuthor, docTitle)
	fileName = strings.ReplaceAll(fileName, "/", "")
	fileName = "." + filepath.Clean(fmt.Sprintf("/%s [%s]%s", fileName, *metadata.PartialMD5, metadata.Type))

	// Open Source File
	sourceFile, err := os.Open(tempFilePath)
	if err != nil {
		log.Error("Source File Error: ", err)
		sendDownloadMessage("Unable to open file", gin.H{"Error": true})
		return
	}
	defer os.Remove(tempFilePath)
	defer sourceFile.Close()

	// Generate Storage Path & Open File
	basePath := filepath.Join(api.cfg.DataPath, "documents")
	safePath := filepath.Join(basePath, fileName)

	destFile, err := os.Create(safePath)
	if err != nil {
		log.Error("Dest File Error: ", err)
		sendDownloadMessage("Unable to create file", gin.H{"Error": true})
		return
	}
	defer destFile.Close()

	// Copy File
	if _, err = io.Copy(destFile, sourceFile); err != nil {
		log.Error("Copy Temp File Error: ", err)
		sendDownloadMessage("Unable to save file", gin.H{"Error": true})
		return
	}

	// Send Message
	sendDownloadMessage("Saving to database...", gin.H{"Progress": 99})

	// Upsert Document
	if _, err = api.db.Queries.UpsertDocument(c, database.UpsertDocumentParams{
		ID:       *metadata.PartialMD5,
		Title:    &docTitle,
		Author:   &docAuthor,
		Md5:      metadata.MD5,
		Words:    metadata.WordCount,
		Filepath: &fileName,
		Basepath: &basePath,
	}); err != nil {
		log.Error("UpsertDocument DB Error: ", err)
		sendDownloadMessage("Unable to save to database", gin.H{"Error": true})
		return
	}

	// Send Message
	sendDownloadMessage("Download Success", gin.H{
		"Progress":   100,
		"ButtonText": "Go to Book",
		"ButtonHref": fmt.Sprintf("./documents/%s", *metadata.PartialMD5),
	})
}

func (api *API) appDemoModeError(c *gin.Context) {
	appErrorPage(c, http.StatusUnauthorized, "Not Allowed in Demo Mode")
}

func (api *API) getDocumentsWordCount(ctx context.Context, documents []database.GetDocumentsWithStatsRow) error {
	// Do Transaction
	tx, err := api.db.DB.Begin()
	if err != nil {
		log.Error("Transaction Begin DB Error: ", err)
		return err
	}

	// Defer & Start Transaction
	defer func() {
		if err := tx.Rollback(); err != nil {
			log.Error("DB Rollback Error:", err)
		}
	}()
	qtx := api.db.Queries.WithTx(tx)

	for _, item := range documents {
		if item.Words == nil && item.Filepath != nil {
			filePath := filepath.Join(api.cfg.DataPath, "documents", *item.Filepath)
			wordCount, err := metadata.GetWordCount(filePath)
			if err != nil {
				log.Warn("Word Count Error: ", err)
			} else {
				if _, err := qtx.UpsertDocument(ctx, database.UpsertDocumentParams{
					ID:    item.ID,
					Words: wordCount,
				}); err != nil {
					log.Error("UpsertDocument DB Error: ", err)
					return err
				}
			}
		}
	}

	// Commit Transaction
	if err := tx.Commit(); err != nil {
		log.Error("Transaction Commit DB Error: ", err)
		return err
	}

	return nil
}

func (api *API) getBaseTemplateVars(routeName string, c *gin.Context) (gin.H, *authData) {
	var auth *authData
	if data, _ := c.Get("Authorization"); data != nil {
		auth = data.(*authData)
	}

	return gin.H{
		"Authorization": auth,
		"RouteName":     routeName,
		"Config": gin.H{
			"Version":             api.cfg.Version,
			"SearchEnabled":       api.cfg.SearchEnabled,
			"RegistrationEnabled": api.cfg.RegistrationEnabled,
		},
	}, auth
}

func bindQueryParams(c *gin.Context, defaultLimit int64) (*queryParams, error) {
	var qParams queryParams
	err := c.BindQuery(&qParams)
	if err != nil {
		return nil, err
	}

	if qParams.Limit == nil {
		qParams.Limit = &defaultLimit
	} else if *qParams.Limit < 0 {
		var zeroValue int64 = 0
		qParams.Limit = &zeroValue
	}

	if qParams.Page == nil || *qParams.Page < 1 {
		var oneValue int64 = 1
		qParams.Page = &oneValue
	}

	return &qParams, nil
}

func appErrorPage(c *gin.Context, errorCode int, errorMessage string) {
	errorHuman := "We're not even sure what happened."

	switch errorCode {
	case http.StatusInternalServerError:
		errorHuman = "Server hiccup."
	case http.StatusNotFound:
		errorHuman = "Something's missing."
	case http.StatusBadRequest:
		errorHuman = "We didn't expect that."
	case http.StatusUnauthorized:
		errorHuman = "You're not allowed to do that."
	}

	c.HTML(errorCode, "page/error", gin.H{
		"Status":  errorCode,
		"Error":   errorHuman,
		"Message": errorMessage,
	})
}
